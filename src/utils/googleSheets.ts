/**
 * Google Sheets sync — "Sign in with Google" edition.
 *
 * Auth strategy: Google Identity Services (GIS) OAuth2 token model.
 * The user clicks ONE button → Google's native account picker pops up →
 * they pick their account → done. No Cloud Console IAM, no service account
 * JSON, no JWT signing. Token auto-refreshes silently every hour.
 *
 * One-time admin setup (3 steps, ~2 minutes):
 *   1. console.cloud.google.com/apis/credentials → "Create Credentials"
 *      → "OAuth client ID" → Application type: "Web application"
 *      → Add your app's origin to "Authorized JavaScript origins"
 *        (e.g. http://192.168.1.x:PORT  or  https://your-domain.com)
 *   2. Copy the Client ID (looks like: 12345-abc.apps.googleusercontent.com)
 *   3. Paste it into the dialog — saved forever.
 *
 * That's it. The Google Sheets API is already available to any authenticated
 * Google user — no separate "Enable API" step required.
 *
 * Append-only logic (unchanged):
 *   - Reads existing sheet rows first
 *   - Deduplicates by TaskID + Date + Programmer
 *   - Inserts only NEW rows at row 2 (newest-first, below the header)
 *   - Thick top border on the first row of each sync batch
 */

import axios from 'axios'
import type { TrackedTimeEntry, GiteaIssue } from '../types/gitea'
import { secondsToHours, formatDDMMYY, hoursToHMStr } from './dateUtils'

// ── GIS token cache ───────────────────────────────────────────────────────────
// Tokens are valid for 1 hour. We cache in memory; on expiry GIS refreshes
// silently (no popup) if the user is still signed into their browser.
interface CachedToken { token: string; expiresAt: number }
let _tokenCache: CachedToken | null = null

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

/** Request a Google OAuth2 access token via GIS. Returns the token string.
 *  Shows a popup only on first call (or after expiry if silent refresh fails). */
export function requestGoogleToken(clientId: string): Promise<string> {
  // Return cached token if still valid (with 60s safety margin)
  if (_tokenCache && _tokenCache.expiresAt - 60_000 > Date.now()) {
    return Promise.resolve(_tokenCache.token)
  }

  return new Promise((resolve, reject) => {
    // @ts-ignore — google is loaded via <script> tag in index.html
    if (!window.google?.accounts?.oauth2) {
      reject(new Error(
        'Google Identity Services library is not loaded. ' +
        'Check your internet connection and reload the page.'
      ))
      return
    }

    // @ts-ignore
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id:   clientId,
      scope:       SHEETS_SCOPE,
      prompt:      '',            // '' = silent if already consented; shows picker otherwise
      callback:    (resp: any) => {
        if (resp.error) {
          reject(new Error(
            resp.error === 'popup_closed_by_user'
              ? 'Sign-in was cancelled. Please try again.'
              : `Google sign-in error: ${resp.error_description ?? resp.error}`
          ))
          return
        }
        const expiresIn = (resp.expires_in ?? 3600) * 1000
        _tokenCache = { token: resp.access_token, expiresAt: Date.now() + expiresIn }
        resolve(resp.access_token as string)
      },
    })
    client.requestAccessToken()
  })
}

/** Sign out — clears the cached token so the next sync shows the account picker again. */
export function revokeGoogleToken(): void {
  if (_tokenCache?.token) {
    // @ts-ignore
    window.google?.accounts?.oauth2?.revoke(_tokenCache.token, () => {})
  }
  _tokenCache = null
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface SheetsConfig {
  /** Full Google Sheets URL OR raw spreadsheet ID. */
  sheetUrl: string
  /** Exact name of the tab/sheet inside the spreadsheet. */
  tabName: string
  /** OAuth 2.0 Client ID from Google Cloud Console (web application type). */
  clientId: string
}

export interface SyncProgress {
  stage: 'idle' | 'signing_in' | 'reading' | 'writing' | 'formatting' | 'done' | 'error'
  message: string
  newRows?: number
  skipped?: number
}

// ── Column constants ──────────────────────────────────────────────────────────
const COL = { TASK_ID: 0, DATE: 2, PROGRAMMER: 3 } as const

export const SHEET_HEADERS: string[] = [
  'Task ID',
  'Task Description',
  'Date (DD/MM/YY)',
  'Programmer',
  'Status',
  'Estimated Hrs (00Hrs 00Min)',
  'Actual Hrs (00Hrs 00Min)',
  'Estimated Start Date (DD/MM/YY)',
  'Estimated End Date (DD/MM/YY)',
  'Actual Start Date (DD/MM/YY)',
  'Actual End Date (DD/MM/YY)',
  'Carry Forwarded (Y/N)',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseSpreadsheetId(input: string): string {
  input = input.trim()
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) return input
  throw new Error(
    'Could not parse a spreadsheet ID. ' +
    'Paste the full Google Sheets URL (https://docs.google.com/spreadsheets/d/…/edit).'
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
  const sorted = [...entries].sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
  )
  const rangeFromMs = rangeFromIso ? new Date(rangeFromIso).getTime() : null

  return sorted.map(entry => {
    const issue      = issues.find(i => i.id === entry.issue_id)
    const issueNum   = entry.issue?.number ?? issue?.number ?? entry.issue_id
    const issueTitle = entry.issue?.title  ?? issue?.title  ?? 'Unknown'
    const issueState = issue?.state ?? entry.issue?.state ?? 'open'

    const programmer = entry.issue?.user?.full_name || entry.issue?.user?.login || username
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
      taskId: String(issueNum), description: issueTitle,
      date: formatDDMMYY(entry.created), programmer, status: statusLabel,
      estimatedHrs, actualHrs: hoursToHMStr(secondsToHours(entry.time)),
      estStartDate: estStart, estEndDate: estEnd,
      actStartDate: formatDDMMYY(entry.created), actEndDate: actEnd,
      carryForwarded,
    }
  })
}

function rowToValues(r: SheetRow): string[] {
  return [
    r.taskId, r.description, r.date, r.programmer, r.status,
    r.estimatedHrs, r.actualHrs, r.estStartDate, r.estEndDate,
    r.actStartDate, r.actEndDate, r.carryForwarded,
  ]
}

function dedupKey(r: SheetRow | string[]): string {
  if (Array.isArray(r)) return `${r[COL.TASK_ID]}||${r[COL.DATE]}||${r[COL.PROGRAMMER]}`
  return `${r.taskId}||${r.date}||${r.programmer}`
}

// ── Sheets API helpers ────────────────────────────────────────────────────────

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const ah   = (t: string) => ({ Authorization: `Bearer ${t}` })
const jh   = { 'Content-Type': 'application/json' }

async function ensureTab(id: string, tabName: string, token: string): Promise<number> {
  const { data } = await axios.get(`${BASE}/${id}`, {
    headers: ah(token), params: { fields: 'sheets.properties' },
  })
  const found = (data.sheets ?? []).find((s: any) => s.properties?.title === tabName)
  if (found) return found.properties.sheetId as number

  const res = await axios.post(
    `${BASE}/${id}:batchUpdate`,
    { requests: [{ addSheet: { properties: { title: tabName } } }] },
    { headers: { ...ah(token), ...jh } }
  )
  return res.data?.replies?.[0]?.addSheet?.properties?.sheetId as number
}

async function readTab(id: string, tabName: string, token: string): Promise<string[][]> {
  try {
    const { data } = await axios.get(
      `${BASE}/${id}/values/${encodeURIComponent(tabName)}`,
      { headers: ah(token) }
    )
    return (data.values ?? []) as string[][]
  } catch { return [] }
}

async function insertRowsAt(
  id: string, sheetId: number, token: string,
  startIdx: number, rowValues: string[][]
): Promise<void> {
  if (!rowValues.length) return
  const rowData = rowValues.map((row, ri) => ({
    values: row.map(cellVal => ({
      userEnteredValue: { stringValue: cellVal },
      ...(ri === 0 ? {
        userEnteredFormat: {
          borders: {
            top: {
              style: 'SOLID_THICK',
              colorStyle: { rgbColor: { red: 0.122, green: 0.204, blue: 0.416 } },
            },
          },
        },
      } : {}),
    })),
  }))

  await axios.post(
    `${BASE}/${id}:batchUpdate`,
    {
      requests: [
        {
          insertDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: startIdx, endIndex: startIdx + rowValues.length },
            inheritFromBefore: false,
          },
        },
        {
          updateCells: {
            rows: rowData,
            fields: 'userEnteredValue,userEnteredFormat.borders',
            start:  { sheetId, rowIndex: startIdx, columnIndex: 0 },
          },
        },
      ],
    },
    { headers: { ...ah(token), ...jh } }
  )
}

async function writeHeader(id: string, sheetId: number, token: string): Promise<void> {
  await axios.post(
    `${BASE}/${id}:batchUpdate`,
    {
      requests: [
        {
          updateCells: {
            rows: [{
              values: SHEET_HEADERS.map(h => ({
                userEnteredValue:  { stringValue: h },
                userEnteredFormat: {
                  backgroundColor: { red: 0.122, green: 0.204, blue: 0.416 },
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10 },
                },
              })),
            }],
            fields: 'userEnteredValue,userEnteredFormat(backgroundColor,textFormat)',
            start:  { sheetId, rowIndex: 0, columnIndex: 0 },
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        {
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: SHEET_HEADERS.length },
          },
        },
      ],
    },
    { headers: { ...ah(token), ...jh } }
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function syncToGoogleSheets(
  config: SheetsConfig,
  entries: TrackedTimeEntry[],
  issues: GiteaIssue[],
  username: string,
  rangeFromIso: string | undefined,
  onProgress: (p: SyncProgress) => void
): Promise<void> {

  // 1 — Validate
  let spreadsheetId: string
  try { spreadsheetId = parseSpreadsheetId(config.sheetUrl) }
  catch (e: any) { throw new Error(e.message) }
  if (!config.tabName.trim()) throw new Error('Tab name cannot be empty.')
  if (!config.clientId.trim()) throw new Error('Client ID cannot be empty.')

  const tabName = config.tabName.trim()

  // 2 — Sign in (silent if already consented; popup only on first use)
  onProgress({ stage: 'signing_in', message: 'Signing in to Google…' })
  let token: string
  try { token = await requestGoogleToken(config.clientId.trim()) }
  catch (e: any) { throw new Error(e.message) }

  // 3 — Ensure tab exists
  onProgress({ stage: 'signing_in', message: `Checking tab "${tabName}"…` })
  let sheetId: number
  let isNew = false
  try {
    const { data } = await axios.get(`${BASE}/${spreadsheetId}`, {
      headers: ah(token), params: { fields: 'sheets.properties.title' },
    })
    const titles: string[] = (data.sheets ?? []).map((s: any) => s.properties?.title ?? '')
    isNew = !titles.includes(tabName)
    sheetId = await ensureTab(spreadsheetId, tabName, token)
  } catch (e: any) { throw wrapErr(e, 'Could not access the spreadsheet') }

  // 4 — Read existing rows
  onProgress({ stage: 'reading', message: 'Reading existing sheet data…' })
  let existing: string[][] = []
  try { existing = await readTab(spreadsheetId, tabName, token) } catch { /* empty */ }
  const dataRows    = existing.length > 1 ? existing.slice(1) : []
  const existingKeys = new Set(dataRows.map(r => dedupKey(r)))

  // 5 — Deduplicate
  onProgress({ stage: 'reading', message: 'Finding new rows to insert…' })
  const allRows  = buildSheetRows(entries, issues, username, rangeFromIso)
  const toInsert = allRows.filter(r => !existingKeys.has(dedupKey(r)))
  const skipped  = allRows.length - toInsert.length

  if (toInsert.length === 0) {
    if (isNew) { try { await writeHeader(spreadsheetId, sheetId, token) } catch {} }
    onProgress({
      stage: 'done',
      message: `All ${allRows.length} row${allRows.length !== 1 ? 's' : ''} already exist — nothing new to add.`,
      newRows: 0, skipped,
    })
    return
  }

  // 6 — Insert new rows at row 2 (newest-first)
  onProgress({ stage: 'writing', message: `Inserting ${toInsert.length} new row${toInsert.length !== 1 ? 's' : ''}…`, newRows: toInsert.length, skipped })
  const values = [...toInsert].reverse().map(rowToValues)
  try { await insertRowsAt(spreadsheetId, sheetId, token, 1, values) }
  catch (e: any) { throw wrapErr(e, 'Could not insert rows') }

  // 7 — Header (new sheet only)
  if (isNew || existing.length === 0) {
    onProgress({ stage: 'formatting', message: 'Writing header row…' })
    try { await writeHeader(spreadsheetId, sheetId, token) } catch {}
  }

  onProgress({
    stage: 'done',
    message: `Added ${toInsert.length} new row${toInsert.length !== 1 ? 's' : ''} to "${tabName}".${skipped > 0 ? ` (${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped)` : ''}`,
    newRows: toInsert.length, skipped,
  })
}

// ── Error helper ──────────────────────────────────────────────────────────────

function wrapErr(e: any, ctx: string): Error {
  if (axios.isAxiosError(e)) {
    const status  = e.response?.status
    const message = e.response?.data?.error?.message ?? e.message
    if (status === 401) return new Error(`${ctx}: Sign-in expired. Click "Sync to Sheets" again to re-authenticate.`)
    if (status === 403) return new Error(`${ctx}: You don't have permission to edit this spreadsheet. Make sure you're signed in with an account that has Editor access.`)
    if (status === 404) return new Error(`${ctx}: Spreadsheet not found. Check the URL is correct and the spreadsheet isn't in Trash.`)
    if (status === 429) return new Error(`${ctx}: Rate limit hit. Wait a moment and try again.`)
    return new Error(`${ctx}: ${message}`)
  }
  return new Error(`${ctx}: ${String(e)}`)
}
