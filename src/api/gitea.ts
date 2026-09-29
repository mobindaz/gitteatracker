import axios, { type AxiosInstance } from 'axios'
import type { GiteaUser, TrackedTimeEntry, HeatmapEntry } from '../types/gitea'

export interface GiteaCredentials {
  baseUrl: string
  username: string
  secret: string // token or password, depending on authMode
  authMode: 'token' | 'basic'
}

export function buildClient(creds: GiteaCredentials): AxiosInstance {
  const authHeader =
    creds.authMode === 'token'
      ? { Authorization: `token ${creds.secret}` }
      : { Authorization: 'Basic ' + btoa(`${creds.username}:${creds.secret}`) }

  return axios.create({
    baseURL: creds.baseUrl.replace(/\/+$/, '') + '/api/v1',
    headers: authHeader,
    timeout: 15000
  })
}

/** GET /user — confirms the credentials work and gives us profile info. */
export async function fetchProfile(client: AxiosInstance): Promise<GiteaUser> {
  const { data } = await client.get('/user')
  return data
}

/** GET /user/times — paginated; fetches the current user's tracked time within the configured range.
 *  Passing `since` dramatically reduces page count since we only need recent entries.
 */
export async function fetchAllTrackedTimes(
  client: AxiosInstance,
  rangeDays = 90
): Promise<TrackedTimeEntry[]> {
  let all: TrackedTimeEntry[] = []
  let page = 1
  const limit = 50

  const since = new Date(Date.now() - rangeDays * 86400000).toISOString()

  while (true) {
    const { data } = await client.get('/user/times', { params: { page, limit, since } })
    if (!Array.isArray(data) || data.length === 0) break
    all = all.concat(data)
    if (data.length < limit || page > 40) break // safety cap
    page++
  }
  return all
}

/**
 * GET /users/{username}/heatmap — daily contribution counts (commits, comments, issues, etc).
 * This is activity, not tracked hours — a secondary signal for "were they working that day".
 * Some instances disable this (ENABLE_USER_HEATMAP=false); treat failures as "unavailable", not fatal.
 */
export async function fetchHeatmap(client: AxiosInstance, username: string): Promise<HeatmapEntry[]> {
  const { data } = await client.get(`/users/${encodeURIComponent(username)}/heatmap`)
  return Array.isArray(data) ? data : []
}

/**
 * GET /repos/issues/search — Search for issues across all accessible repositories
 * Uses assigned=true and created=true to get user's issues
 */
export async function fetchUserIssues(
  client: AxiosInstance,
  state: 'open' | 'closed' | 'all' = 'all'
): Promise<any[]> {
  const limit = 50

  /** Fetch all pages for a single search filter (assigned or created). */
  async function fetchAllPages(filter: 'assigned' | 'created'): Promise<any[]> {
    const results: any[] = []
    let page = 1
    while (true) {
      const { data } = await client.get('/repos/issues/search', {
        params: {
          page,
          limit,
          state,
          [filter]: true,
          type: 'issues'
        }
      })
      const issues = Array.isArray(data) ? data : (data?.data || [])
      if (!Array.isArray(issues) || issues.length === 0) break
      results.push(...issues)
      if (issues.length < limit || page > 20) break
      page++
    }
    return results
  }

  try {
    // Run both paginated loops in parallel instead of sequentially.
    const [assigned, created] = await Promise.all([
      fetchAllPages('assigned'),
      fetchAllPages('created')
    ])

    // Merge, deduplicating by issue id.
    const seen = new Set<number>()
    const merged: any[] = []
    for (const issue of [...assigned, ...created]) {
      if (!seen.has(issue.id)) {
        seen.add(issue.id)
        merged.push(issue)
      }
    }
    return merged
  } catch (error) {
    console.error('Error fetching user issues:', error)
    return []
  }
}

/**
 * Fetch issue details by ID from repository
 * This is a fallback to get issue details when we have issue_id from time entries
 */
export async function fetchIssueById(
  client: AxiosInstance,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<any | null> {
  try {
    const { data } = await client.get(`/repos/${owner}/${repo}/issues/${issueNumber}`)
    return data
  } catch (error) {
    console.error(`Error fetching issue ${owner}/${repo}#${issueNumber}:`, error)
    return null
  }
}

/**
 * GET /repos/{owner}/{repo}/issues/{index}/times — fetch time tracking for a specific issue
 */
export async function fetchIssueTimeTracking(
  client: AxiosInstance,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<TrackedTimeEntry[]> {
  try {
    const { data } = await client.get(`/repos/${owner}/${repo}/issues/${issueNumber}/times`)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * GET /user/stopwatches — returns all currently running stopwatches for the
 * authenticated user. Each stopwatch represents a live "Start timer" press
 * on a Gitea issue. This is the correct way to detect what ticket is
 * actively being worked on right now (as opposed to time entries, which are
 * historical logs that may include tickets from earlier in the day).
 *
 * Response shape per the official Gitea API docs:
 *   created          — ISO timestamp when the timer was started
 *   duration         — human-readable string e.g. "1h 23m"
 *   issue_index      — issue number within the repo
 *   issue_title      — title of the issue
 *   repo_name        — repository name
 *   repo_owner_name  — repository owner login
 *   seconds          — total elapsed seconds since the timer started
 */
export interface GiteaStopwatch {
  created:         string
  duration:        string
  issue_index:     number
  issue_title:     string
  repo_name:       string
  repo_owner_name: string
  seconds:         number
}

export async function fetchStopwatches(client: AxiosInstance): Promise<GiteaStopwatch[]> {
  try {
    const { data } = await client.get('/user/stopwatches')
    return Array.isArray(data) ? data : []
  } catch {
    // Not all Gitea versions support stopwatches — treat failure as "none running"
    return []
  }
}
export function describeConnectionError(e: any, baseUrl: string): string {
  if (e?.response?.status === 401) return 'Authentication failed — check your username/token.'
  if (e?.response?.status === 404) return 'Endpoint not found (404) — check the server URL and that it is a Gitea instance.'
  if (e?.response) return e.response.data?.message || `Server responded with ${e.response.status}.`

  const pageIsHttps = window.location.protocol === 'https:'
  const targetIsHttp = /^http:\/\//i.test(baseUrl.trim())
  if (pageIsHttps && targetIsHttp) {
    return (
      'Blocked: this page is loaded over HTTPS and your Gitea URL is HTTP (mixed content). ' +
      'Save this app and open it directly (or run it via `npm run dev`/`npm run preview`) instead of ' +
      'an HTTPS-hosted preview, or put Gitea behind HTTPS.'
    )
  }
  return (
    "Could not reach that Gitea instance — this is usually CORS. Add to Gitea's app.ini: " +
    '[cors] ENABLED = true, ALLOW_DOMAIN = * (then restart Gitea), and confirm the URL/port are correct.'
  )
}
