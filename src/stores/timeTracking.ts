import { defineStore } from 'pinia'
import type { TrackedTimeEntry, HeatmapEntry, GiteaIssue } from '../types/gitea'
import { fetchAllTrackedTimes, fetchHeatmap, fetchStopwatches, describeConnectionError } from '../api/gitea'
import type { GiteaStopwatch } from '../api/gitea'
import { useAuthStore } from './auth'
import {
  toDateKey,
  dateKeyToLabel,
  toWeekKey,
  weekKeyToLabel,
  toMonthKey,
  monthKeyToLabel,
  secondsToHours,
  todayDateKey
} from '../utils/dateUtils'

const SETTINGS_KEY = 'gitea-tracker-settings'

interface GroupSummary {
  key: string
  label: string
  entries: number
  hours: number
  target: number
  diff: number // target - hours; positive = short, negative = over
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return { targetHoursPerDay: 8, workDaysPerWeek: 5, rangeDays: 90 }
}

export const useTimeTrackingStore = defineStore('timeTracking', {
  state: () => ({
    entries: [] as TrackedTimeEntry[],
    heatmap: [] as HeatmapEntry[],
    issues: [] as GiteaIssue[],
    stopwatches: [] as GiteaStopwatch[],   // live running timers from /user/stopwatches
    heatmapUnavailable: false,
    loading: false,
    loadError: '',
    _lastFetchedAt: 0,
    _fetchPromise: null as Promise<void> | null,
    ...loadSettings() as { targetHoursPerDay: number; workDaysPerWeek: number; rangeDays: number }
  }),

  getters: {
    // ── ALL entries regardless of range (for today's hours, etc.) ───────────
    allEntries(state): TrackedTimeEntry[] {
      return state.entries
    },

    // ── Entries filtered by the configured rangeDays window ─────────────────
    // Used for weekly / monthly chart tabs so they show data within the window
    withinRange(state): TrackedTimeEntry[] {
      const cutoff = Date.now() - state.rangeDays * 86400000
      return state.entries.filter((e) => new Date(e.created).getTime() >= cutoff)
    },

    totalHoursAllTime(state): number {
      return secondsToHours(state.entries.reduce((s, e) => s + (e.time || 0), 0))
    },

    // ── TODAY hours — always computed from ALL entries, never gated by range ─
    todayHours(): number {
      const today = todayDateKey()
      const secs = this.allEntries
        .filter(e => toDateKey(e.created) === today)
        .reduce((s, e) => s + (e.time || 0), 0)
      return secondsToHours(secs)
    },

    // ── Today entry count ────────────────────────────────────────────────────
    todayEntries(): number {
      const today = todayDateKey()
      return this.allEntries.filter(e => toDateKey(e.created) === today).length
    },

    // ── Daily summaries from withinRange (for reports / chart) ──────────────
    dailySummaries(): GroupSummary[] {
      const byDate = new Map<string, TrackedTimeEntry[]>()
      for (const e of this.withinRange) {
        const key = toDateKey(e.created)
        if (!byDate.has(key)) byDate.set(key, [])
        byDate.get(key)!.push(e)
      }
      const target = this.targetHoursPerDay
      return Array.from(byDate.entries())
        .map(([key, rows]) => {
          const hours = secondsToHours(rows.reduce((s, r) => s + (r.time || 0), 0))
          return {
            key,
            label: dateKeyToLabel(key),
            entries: rows.length,
            hours,
            target,
            diff: round2(target - hours)
          }
        })
        .sort((a, b) => b.key.localeCompare(a.key))
    },

    // ── Weekly summaries from withinRange ────────────────────────────────────
    weeklySummaries(): GroupSummary[] {
      const byWeek = new Map<string, TrackedTimeEntry[]>()
      for (const e of this.withinRange) {
        const key = toWeekKey(e.created)
        if (!byWeek.has(key)) byWeek.set(key, [])
        byWeek.get(key)!.push(e)
      }
      const target = this.targetHoursPerDay * this.workDaysPerWeek
      return Array.from(byWeek.entries())
        .map(([key, rows]) => {
          const hours = secondsToHours(rows.reduce((s, r) => s + (r.time || 0), 0))
          return {
            key,
            label: weekKeyToLabel(key),
            entries: rows.length,
            hours,
            target,
            diff: round2(target - hours)
          }
        })
        .sort((a, b) => b.key.localeCompare(a.key))
    },

    // ── Monthly summaries from withinRange ───────────────────────────────────
    monthlySummaries(): GroupSummary[] {
      const byMonth = new Map<string, TrackedTimeEntry[]>()
      for (const e of this.withinRange) {
        const key = toMonthKey(e.created)
        if (!byMonth.has(key)) byMonth.set(key, [])
        byMonth.get(key)!.push(e)
      }
      const perMonthTarget = this.targetHoursPerDay * this.workDaysPerWeek * 4.345
      return Array.from(byMonth.entries())
        .map(([key, rows]) => {
          const hours = secondsToHours(rows.reduce((s, r) => s + (r.time || 0), 0))
          return {
            key,
            label: monthKeyToLabel(key),
            entries: rows.length,
            hours,
            target: round2(perMonthTarget),
            diff: round2(perMonthTarget - hours)
          }
        })
        .sort((a, b) => b.key.localeCompare(a.key))
    },

    // ── Overall stats for the configured range ───────────────────────────────
    overallStats(): { daysWorked: number; entries: number; hours: number; target: number; diff: number } {
      const rows = this.dailySummaries
      const entries = rows.reduce((s, r) => s + r.entries, 0)
      const hours = round2(rows.reduce((s, r) => s + r.hours, 0))
      const target = round2(rows.reduce((s, r) => s + r.target, 0))
      return { daysWorked: rows.length, entries, hours, target, diff: round2(target - hours) }
    },

    // ── Current week hours — always from ALL entries (not range-limited) ─────
    currentWeekHours(): number {
      const now   = new Date()
      const day   = now.getDay()
      const mon   = new Date(now)
      mon.setDate(now.getDate() - ((day + 6) % 7))
      mon.setHours(0, 0, 0, 0)
      const monTs = mon.getTime()
      return this.allEntries
        .filter(e => new Date(e.created).getTime() >= monTs)
        .reduce((s, e) => s + (e.time || 0), 0) / 3600
    },

    // ── Current week hours broken down by day Mon–Sun ────────────────────────
    currentWeekDays(): Array<{ label: string; hours: number; isToday: boolean; isFuture: boolean }> {
      const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      const now    = new Date()
      const day    = now.getDay()
      const mon    = new Date(now)
      mon.setDate(now.getDate() - ((day + 6) % 7))
      mon.setHours(0, 0, 0, 0)
      const todayKey = todayDateKey()

      return labels.map((label, i) => {
        const d = new Date(mon)
        d.setDate(mon.getDate() + i)
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
        const hours = this.allEntries
          .filter(e => toDateKey(e.created) === key)
          .reduce((s, e) => s + (e.time || 0), 0) / 3600
        const isToday = key === todayKey
        // isFuture: any day index beyond today's day-of-week
        const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1 // Mon=0..Sun=6
        return {
          label,
          hours: Math.round(hours * 100) / 100,
          isToday,
          isFuture: i > todayDow
        }
      })
    },

    // ── Heatmap re-keyed by date ─────────────────────────────────────────────
    heatmapByDate(state): Record<string, number> {
      const map: Record<string, number> = {}
      for (const h of state.heatmap) {
        const key = toDateKey(new Date(h.timestamp * 1000).toISOString())
        map[key] = (map[key] || 0) + h.contributions
      }
      return map
    }
  },

  actions: {
    persistSettings() {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          targetHoursPerDay: this.targetHoursPerDay,
          workDaysPerWeek: this.workDaysPerWeek,
          rangeDays: this.rangeDays
        })
      )
    },

    async forceRefresh() {
      this._lastFetchedAt = 0
      this._fetchPromise = null
      return this.fetchAll()
    },

    /** Poll the running stopwatches endpoint every 30 s independently of the
     *  full data fetch — this keeps the "now working" indicator accurate
     *  without refetching all time entries. */
    async refreshStopwatches() {
      const auth = useAuthStore()
      if (!auth.client) return
      this.stopwatches = await fetchStopwatches(auth.client)
    },

    async fetchAll(staleTtlMs = 30_000) {
      const auth = useAuthStore()
      if (!auth.client) return

      if (this._fetchPromise) return this._fetchPromise

      if (this.entries.length > 0 && Date.now() - this._lastFetchedAt < staleTtlMs) return

      this._fetchPromise = this._doFetchAll().finally(() => {
        this._fetchPromise = null
      })
      return this._fetchPromise
    },

    async _doFetchAll() {
      const auth = useAuthStore()
      if (!auth.client) return
      this.loading = true
      this.loadError = ''
      try {
        // Fetch entries. We always fetch from a reasonably wide window (max of
        // rangeDays and 365 so that todayHours is never artificially empty when
        // rangeDays is small, e.g. 7 days).
        const fetchDays = Math.max(this.rangeDays, 365)
        this.entries = await fetchAllTrackedTimes(auth.client, fetchDays)

        const issueMap = new Map<number, any>()
        this.entries.forEach(entry => {
          if (entry.issue && !issueMap.has(entry.issue_id)) {
            const iss     = entry.issue
            const repoData = iss.repository
            issueMap.set(entry.issue_id, {
              id:          entry.issue_id,
              number:      iss.number,
              title:       iss.title,
              state:       iss.state || 'open',
              // The embedded issue uses created_at (full ISO), falling back to created
              created_at:  iss.created_at || iss.created || new Date().toISOString(),
              updated_at:  iss.updated    || new Date().toISOString(),
              closed_at:   iss.state === 'closed'
                ? (iss.closed_at || iss.closed || new Date().toISOString())
                : null,
              // due_date: deadline / Estimated End Date
              due_date:    iss.due_date ?? iss.milestone?.due_on ?? null,
              // time_estimate: the real "Estimated Hrs" field (seconds)
              time_estimate:       iss.time_estimate ?? null,
              total_tracked_time:  iss.total_tracked_time ?? null,
              labels:    iss.labels    || [],
              milestone: iss.milestone || null,
              repository: repoData
                ? { id: 0, name: repoData.name || '', full_name: repoData.full_name || 'Unknown', owner: { login: '' } }
                : { id: 0, name: '', full_name: 'Unknown', owner: { login: '' } },
            })
          }
        })
        this.issues = Array.from(issueMap.values())
        this._lastFetchedAt = Date.now()

      } catch (e) {
        this.loadError = describeConnectionError(e, auth.baseUrl)
      }

      try {
        if (auth.username) {
          this.heatmap = await fetchHeatmap(auth.client, auth.username)
          this.heatmapUnavailable = false
        }
      } catch {
        this.heatmapUnavailable = true
      }

      // Fetch running stopwatches — tells us what ticket is ACTIVELY running right now
      try {
        this.stopwatches = await fetchStopwatches(auth.client)
      } catch {
        // non-fatal — older Gitea versions may not have this endpoint
      }

      this.loading = false
    }
  }
})

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
