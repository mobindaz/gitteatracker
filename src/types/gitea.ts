// Shapes for the three Gitea endpoints this app calls. Trimmed to the fields we use —
// Gitea's real responses have more fields than this.

export interface GiteaUser {
  id: number
  login: string
  full_name: string
  email: string
  avatar_url: string
}

// GET /api/v1/user/issues — issues assigned to user
export interface GiteaIssue {
  id: number
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  created_at: string
  updated_at: string
  closed_at?: string
  /** Due date set on the issue — used as Estimated End Date in exports. */
  due_date?: string | null
  /** Estimated time in SECONDS set on the issue via Gitea's time_estimate field. */
  time_estimate?: number
  /** Total seconds tracked across ALL users for this issue (Gitea field). */
  total_tracked_time?: number
  labels: Array<{
    id: number
    name: string
    color: string
  }>
  assignees?: Array<{
    id: number
    login: string
    full_name: string
  }>
  /** Milestone attached to the issue — milestone.due_on is a fallback for Estimated End Date. */
  milestone?: {
    id: number
    title: string
    due_on?: string | null
    closed_at?: string | null
  } | null
  repository: {
    id: number
    name: string
    full_name: string
    owner: {
      login: string
    }
  }
}

// GET /api/v1/user/times — one row per tracked-time entry the current user has logged,
// across every repo they can access.
export interface TrackedTimeEntry {
  id: number
  created: string // ISO timestamp
  time: number // seconds
  user_id: number
  user_name: string
  issue_id: number
  // Present on some Gitea versions when the issue is expanded; absent on others.
  issue?: {
    id: number
    number: number
    title: string
    state?: 'open' | 'closed'
    created_at?: string          // ISO timestamp (created_at on the issue object)
    created?: string             // ISO timestamp — some Gitea versions include this
    updated?: string             // ISO timestamp — some Gitea versions include this
    closed?: string              // ISO timestamp — present when state is 'closed'
    closed_at?: string | null
    /** Due date / deadline set on the issue — Estimated End Date in exports. */
    due_date?: string | null
    /** Estimated time in SECONDS set on the issue via Gitea's time_estimate field. */
    time_estimate?: number
    /** Total seconds tracked across ALL users (not an estimate). */
    total_tracked_time?: number
    labels?: Array<{
      id: number
      name: string
      color: string
    }>
    /** Milestone attached to the issue — milestone.due_on is a fallback for Estimated End Date. */
    milestone?: {
      id: number
      title: string
      due_on?: string | null
    } | null
    repository?: {
      name: string
      full_name: string
    }
    /** User who created the issue — present in the /user/times embedded issue object. */
    user?: {
      id: number
      login: string
      full_name?: string
    } | null
  }
}

// GET /api/v1/users/{username}/heatmap — daily contribution counts (commits, issues,
// comments, etc. — NOT the same as tracked hours, but a useful "were they active" signal).
export interface HeatmapEntry {
  timestamp: number // unix seconds
  contributions: number
}
