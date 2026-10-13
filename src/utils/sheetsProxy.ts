/**
 * Google Sheets sync via Apps Script Web App proxy.
 *
 * HOW IT WORKS — zero Cloud Console setup:
 *
 *   1. Open your Google Sheet
 *   2. Extensions → Apps Script
 *   3. Paste the script below, click Save
 *   4. Click "Deploy" → "New deployment" → Type: Web App
 *      → Execute as: Me  → Who has access: Anyone
 *   5. Copy the Web App URL and paste it into the app — done forever.
 *
 * ─── Apps Script to paste ────────────────────────────────────────────────────
 *
 * function doPost(e) {
 *   try {
 *     var data = e.parameter.payload
 *       ? JSON.parse(e.parameter.payload)
 *       : JSON.parse(e.postData.contents);
 *     var ss  = SpreadsheetApp.openById(data.spreadsheetId);
 *     var tab = ss.getSheetByName(data.tabName)
 *             || ss.insertSheet(data.tabName);
 *
 *     var existing = tab.getDataRange().getValues();
 *
 *     // Write header if sheet is empty OR first cell doesn't match our header.
 *     var hasHeader = existing.length > 0
 *       && existing[0][0] === data.headers[0]
 *       && existing[0][data.headers.length - 1] === data.headers[data.headers.length - 1];
 *
 *     if (!hasHeader) {
 *       if (existing.length === 0) {
 *         tab.appendRow(data.headers);
 *       } else {
 *         tab.insertRowsBefore(1, 1);
 *         tab.getRange(1, 1, 1, data.headers.length).setValues([data.headers]);
 *         existing = tab.getDataRange().getValues();
 *       }
 *       var hRange = tab.getRange(1, 1, 1, data.headers.length);
 *       hRange.setBackground('#1F3369').setFontColor('#FFFFFF')
 *             .setFontWeight('bold').setFontSize(10);
 *       tab.setFrozenRows(1);
 *       tab.autoResizeColumns(1, data.headers.length);
 *     }
 *
 *     var keys = {};
 *     for (var i = 1; i < existing.length; i++) {
 *       var r = existing[i];
 *       if (r[0]) keys[r[0] + '||' + r[2] + '||' + r[3]] = true;
 *     }
 *     var newRows = data.rows.filter(function(r) {
 *       return !keys[r[0] + '||' + r[2] + '||' + r[3]];
 *     });
 *
 *     if (newRows.length > 0) {
 *       tab.insertRowsBefore(2, newRows.length);
 *       var dataRange = tab.getRange(2, 1, newRows.length, data.headers.length);
 *       dataRange.setValues(newRows);
 *       dataRange.setBorder(false, false, false, false, false, false);
 *     }
 *
 *     // Clear borders on entire sheet (removes any borders from previous syncs)
 *     var fullRange = tab.getDataRange();
 *     fullRange.setBorder(false, false, false, false, false, false);
 *
 *     return ContentService.createTextOutput(
 *       JSON.stringify({ ok: true, inserted: newRows.length, skipped: data.rows.length - newRows.length })
 *     ).setMimeType(ContentService.MimeType.JSON);
 *   } catch(err) {
 *     return ContentService.createTextOutput(
 *       JSON.stringify({ ok: false, error: err.message })
 *     ).setMimeType(ContentService.MimeType.JSON);
 *   }
 * }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import axios from 'axios'
import type { TrackedTimeEntry, GiteaIssue } from '../types/gitea'
import { secondsToHours, formatDDMMYY, hoursToHMStr } from './dateUtils'

// ── Storage key ───────────────────────────────────────────────────────────────
export const PROXY_STORAGE_KEY = 'gitea-tracker-sheets-proxy'

// ── Column headers ────────────────────────────────────────────────────────────
export const SHEET_HEADERS: string[] = [
  'Task ID',
  'Task Description',
  'Date (DD/MM/YYYY)',
  'Programmer',
  'Status',
  'Estimated Hrs (00Hrs 00Min)',
  'Actual Hrs (00Hrs 00Min)',
  'Estimated Start Date (DD/MM/YYYY)',
  'Estimated End Date (DD/MM/YYYY)',
  'Actual Start Date (DD/MM/YYYY)',
  'Actual End Date (DD/MM/YYYY)',
  'Carry Forwarded (Y/N)',
]

// ── Config type ───────────────────────────────────────────────────────────────
export interface ProxyConfig {
  /** The Apps Script Web App URL (ends with /exec) */
  webAppUrl: string
  /** Full Google Sheets URL or raw spreadsheet ID */
  sheetUrl: string
  /** Exact tab name — created automatically if missing */
  tabName: string
}

export interface SyncProgress {
  stage: 'idle' | 'building' | 'sending' | 'done' | 'error'
  message: string
  newRows?: number
  skipped?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseSpreadsheetId(input: string): string {
  input = input.trim()
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) return input
  throw new Error(
    'Could not read the spreadsheet ID from the URL. ' +
    'Paste the full Google Sheets link (https://docs.google.com/spreadsheets/d/…/edit).'
  )
}

// ── Row builder ───────────────────────────────────────────────────────────────
export interface SheetRow {
  taskId: string; description: string; date: string; programmer: string
  status: string; estimatedHrs: string; actualHrs: string
  estStartDate: string; estEndDate: string; actStartDate: string
  actEndDate: string; carryForwarded: string
}

export function buildSheetRows(
  entries: TrackedTimeEntry[],
  issues: GiteaIssue[],
  username: string,
  rangeFromIso?: string
): SheetRow[] {
  const rangeFromMs = rangeFromIso ? new Date(rangeFromIso).getTime() : null

  // ── Aggregate: group by (issueId, date) and sum seconds ──────────────────
  // Key: "<issueId>||<YYYY-MM-DD>"
  const grouped = new Map<string, {
    totalSeconds: number
    entry: TrackedTimeEntry   // representative entry for metadata
    dateStr: string           // YYYY-MM-DD date key
  }>()

  for (const entry of entries) {
    const dateKey = entry.created.split('T')[0]
    const mapKey  = `${entry.issue_id}||${dateKey}`
    const cur = grouped.get(mapKey)
    if (cur) {
      cur.totalSeconds += entry.time ?? 0
    } else {
      grouped.set(mapKey, {
        totalSeconds: entry.time ?? 0,
        entry,
        dateStr: dateKey,
      })
    }
  }

  // ── Sort aggregated rows by date ascending ────────────────────────────────
  const aggregated = [...grouped.values()].sort(
    (a, b) => a.dateStr.localeCompare(b.dateStr)
  )

  return aggregated.map(({ totalSeconds, entry, dateStr }) => {
    const issue      = issues.find(i => i.id === entry.issue_id)
    const issueNum   = entry.issue?.number ?? issue?.number ?? entry.issue_id
    const issueTitle = entry.issue?.title  ?? issue?.title  ?? 'Unknown'
    const issueState = issue?.state ?? entry.issue?.state ?? 'open'

    // Programmer: prefer full_name from the embedded user object
    const programmer =
      entry.issue?.user?.full_name ||
      entry.issue?.user?.login     ||
      username

    const statusLabel = issueState === 'closed' ? 'Completed' : 'In Progress'

    const estSecs = issue?.time_estimate ?? entry.issue?.time_estimate ?? null
    const estimatedHrs = estSecs && estSecs > 0 ? hoursToHMStr(secondsToHours(estSecs)) : '—'

    const rawDue = issue?.due_date ?? entry.issue?.due_date ?? issue?.milestone?.due_on ?? null
    const estEnd = rawDue ? formatDDMMYY(rawDue) : '—'

    const estStart = issue?.created_at || entry.issue?.created_at
      ? formatDDMMYY((issue?.created_at || entry.issue?.created_at)!)
      : '—'

    const actEnd = issueState === 'closed' && issue?.closed_at
      ? formatDDMMYY(issue.closed_at) : '—'

    let carryForwarded = 'N'
    if (rangeFromMs && issue?.created_at && new Date(issue.created_at).getTime() < rangeFromMs) {
      carryForwarded = 'Y'
    }

    return {
      taskId:        String(issueNum),
      description:   issueTitle,
      date:          formatDDMMYY(dateStr + 'T00:00:00'),
      programmer,
      status:        statusLabel,
      estimatedHrs,
      actualHrs:     hoursToHMStr(secondsToHours(totalSeconds)),
      estStartDate:  estStart,
      estEndDate:    estEnd,
      actStartDate:  formatDDMMYY(dateStr + 'T00:00:00'),
      actEndDate:    actEnd,
      carryForwarded,
    }
  })
}

function rowToArray(r: SheetRow): string[] {
  return [
    r.taskId, r.description, r.date, r.programmer, r.status,
    r.estimatedHrs, r.actualHrs,
    r.estStartDate, r.estEndDate, r.actStartDate, r.actEndDate,
    r.carryForwarded,
  ]
}

// ── Main sync function ────────────────────────────────────────────────────────

export async function syncViaProxy(
  config: ProxyConfig,
  entries: TrackedTimeEntry[],
  issues: GiteaIssue[],
  username: string,
  rangeFromIso: string | undefined,
  onProgress: (p: SyncProgress) => void,
  excludeTicketIds: string[] = []
): Promise<void> {

  // Validate
  if (!config.webAppUrl.trim())
    throw new Error('Please enter the Apps Script Web App URL.')
  if (!config.sheetUrl.trim())
    throw new Error('Please enter the Google Sheets URL.')
  if (!config.tabName.trim())
    throw new Error('Please enter a tab name.')

  let spreadsheetId: string
  try { spreadsheetId = parseSpreadsheetId(config.sheetUrl) }
  catch (e: any) { throw new Error(e.message) }

  // Build rows, filter out excluded tickets
  onProgress({ stage: 'building', message: 'Building rows from Gitea data…' })
  const excludeSet = new Set(excludeTicketIds.map(id => id.replace(/^#/, '').trim()))
  let rows = buildSheetRows(entries, issues, username, rangeFromIso)
  if (excludeSet.size > 0) {
    rows = rows.filter(r => !excludeSet.has(r.taskId.replace(/^#/, '')))
  }

  // Send newest-first so latest work appears at the top
  const rowsDesc = [...rows].reverse().map(rowToArray)

  onProgress({
    stage: 'sending',
    message: `Sending ${rows.length} row${rows.length !== 1 ? 's' : ''} to Google Sheets…`,
  })

  const payload = {
    spreadsheetId,
    tabName:  config.tabName.trim(),
    headers:  SHEET_HEADERS,
    rows:     rowsDesc,
  }

  let result: any
  try {
    const form = new FormData()
    form.append('payload', JSON.stringify(payload))

    const resp = await fetch(config.webAppUrl.trim(), {
      method: 'POST',
      body:   form,
    })

    const text = await resp.text()
    try { result = JSON.parse(text) }
    catch { result = { ok: false, error: `Unexpected response: ${text.slice(0, 200)}` } }
  } catch (e: any) {
    throw new Error(
      `Could not reach the Apps Script Web App.\n` +
      `Check the URL is correct and the deployment is set to "Anyone can access".\n` +
      `Error: ${e.message}`
    )
  }

  if (!result.ok) {
    throw new Error(
      `Apps Script returned an error: ${result.error ?? 'Unknown error'}.\n` +
      `Make sure the script has access to the spreadsheet (it must be owned by the same Google account).`
    )
  }

  onProgress({
    stage:   'done',
    message: `Added ${result.inserted} new row${result.inserted !== 1 ? 's' : ''} to "${config.tabName}".${
      result.skipped > 0 ? ` (${result.skipped} duplicate${result.skipped !== 1 ? 's' : ''} skipped)` : ''
    }`,
    newRows: result.inserted,
    skipped: result.skipped ?? 0,
  })
}
