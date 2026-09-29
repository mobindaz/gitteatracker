import * as XLSX from 'xlsx'
import type { TrackedTimeEntry, GiteaIssue } from '../types/gitea'
import { secondsToHours, toDateKey, todayDateKey } from './dateUtils'

interface GroupRow {
  key: string
  label: string
  entries: number
  hours: number
  target: number
  diff: number
}

function summarySheet(rows: GroupRow[], periodLabel: string) {
  return rows.map((r) => ({
    [periodLabel]: r.label,
    'Entries': r.entries,
    'Worked (h)': r.hours,
    'Target (h)': r.target,
    'Missing / Overage (h)': r.diff
  }))
}

function rawSheet(entries: TrackedTimeEntry[]) {
  return entries
    .slice()
    .sort((a, b) => b.created.localeCompare(a.created))
    .map((e) => ({
      'Date': toDateKey(e.created),
      'Time (local)': new Date(e.created).toLocaleTimeString(),
      'Issue #': e.issue?.number ?? e.issue_id,
      'Issue title': e.issue?.title ?? '',
      'Repository': e.issue?.repository?.full_name ?? '',
      'Hours': secondsToHours(e.time)
    }))
}

// Format date to DD/MM/YYYY
function formatExcelDate(dateStr: string): string {
  const date = new Date(dateStr)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

// Ticket details sheet - ONE ROW PER TICKET (aggregated)
function ticketDetailsSheet(entries: TrackedTimeEntry[], issues: GiteaIssue[], username: string) {
  // Get unique issue IDs from entries
  const issueIdsWithTime = new Set(entries.map(e => e.issue_id))
  
  // Group entries by issue to calculate totals
  const issueTimeMap = new Map<number, number>()
  const issueFirstEntryMap = new Map<number, string>()
  const issueLastEntryMap = new Map<number, string>()
  
  entries.forEach(e => {
    const current = issueTimeMap.get(e.issue_id) || 0
    issueTimeMap.set(e.issue_id, current + (e.time || 0))
    
    // Track first and last entry dates
    const firstEntry = issueFirstEntryMap.get(e.issue_id)
    if (!firstEntry || e.created < firstEntry) {
      issueFirstEntryMap.set(e.issue_id, e.created)
    }
    
    const lastEntry = issueLastEntryMap.get(e.issue_id)
    if (!lastEntry || e.created > lastEntry) {
      issueLastEntryMap.set(e.issue_id, e.created)
    }
  })

  // Create one row per ticket
  return issues
    .filter(issue => issueIdsWithTime.has(issue.id))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .map((issue) => {
      const totalTime = secondsToHours(issueTimeMap.get(issue.id) || 0)
      const progress = issue.state === 'closed' ? 100 : Math.min(95, Math.round((totalTime / 8) * 100))
      const firstEntry = issueFirstEntryMap.get(issue.id)
      const lastEntry = issueLastEntryMap.get(issue.id)

      return {
        'Task ID': `#${issue.number}`,
        'Status': issue.state,
        'Progress (%)': progress,
        'Estimated (Hrs)': '—',
        'Actual (Hrs)': totalTime.toFixed(2),
        'Estimated Start Date': formatExcelDate(issue.created_at),
        'Estimated End Date': '—',
        'Actual Start Date': firstEntry ? formatExcelDate(firstEntry) : '—',
        'Actual End Date': issue.closed_at ? formatExcelDate(issue.closed_at) : '—',
        'Exceeded': '—',
        'Carry Forward (%)': '—',
        'Idle Time (Hrs)': '0',
        'Issue Title': issue.title,
        'Repository': issue.repository?.full_name || '—',
      }
    })
}

// Active issues sheet
function activeIssuesSheet(entries: TrackedTimeEntry[], issues: GiteaIssue[], username: string) {
  const issueIdsWithTime = new Set(entries.map(e => e.issue_id))
  const issueTimeMap = new Map<number, number>()
  
  entries.forEach(e => {
    const current = issueTimeMap.get(e.issue_id) || 0
    issueTimeMap.set(e.issue_id, current + (e.time || 0))
  })

  return issues
    .filter(issue => issue.state === 'open' && issueIdsWithTime.has(issue.id))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .map(issue => ({
      'Issue #': issue.number,
      'Title': issue.title,
      'Repository': issue.repository?.full_name || '—',
      'State': issue.state,
      'Labels': issue.labels?.map(l => l.name).join(', ') || '—',
      'Total Time (Hrs)': secondsToHours(issueTimeMap.get(issue.id) || 0).toFixed(2),
      'Created': formatExcelDate(issue.created_at),
      'Last Updated': formatExcelDate(issue.updated_at),
    }))
}

/**
 * Every row in this workbook comes from GET /user/times — a Gitea endpoint that only ever
 * returns the currently authenticated user's own tracked time. There is no cross-user data
 * mixed in here by construction.
 */
export function exportGiteaWorkbook(params: {
  username: string
  allEntries: TrackedTimeEntry[]
  daily: GroupRow[]
  weekly: GroupRow[]
  monthly: GroupRow[]
  issues?: GiteaIssue[]
}) {
  const wb = XLSX.utils.book_new()

  const todaysEntries = params.allEntries.filter((e) => toDateKey(e.created) === todayDateKey())
  const issues = params.issues || []

  const addSheet = (name: string, rows: any[]) => {
    if (rows.length === 0) {
      // Add empty sheet with headers if no data
      rows = [{}]
    }
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  // Ticket Details - ONE ROW PER TICKET (main sheet)
  addSheet('Ticket Details', ticketDetailsSheet(params.allEntries, issues, params.username))
  
  // Active tickets (open only)
  const activeIssues = issues.filter(i => i.state === 'open' && params.allEntries.some(e => e.issue_id === i.id))
  addSheet('Active Tickets', ticketDetailsSheet(params.allEntries.filter(e => activeIssues.some(i => i.id === e.issue_id)), activeIssues, params.username))
  
  // Traditional sheets
  addSheet('Today', rawSheet(todaysEntries))
  addSheet('Daily Summary', summarySheet(params.daily, 'Date'))
  addSheet('Weekly Summary', summarySheet(params.weekly, 'Week'))
  addSheet('Monthly Summary', summarySheet(params.monthly, 'Month'))
  addSheet('All Time Entries', rawSheet(params.allEntries))

  const stamp = todayDateKey()
  XLSX.writeFile(wb, `gitea-time-${params.username.replace(/\s+/g, '-').toLowerCase()}-${stamp}.xlsx`)
}

