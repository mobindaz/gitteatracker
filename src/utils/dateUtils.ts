// All grouping in this app works off the entry's `created` ISO timestamp, using the
// browser's local timezone for day/week/month boundaries.

export function toDateKey(iso: string): string {
  const d = new Date(iso)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function dateKeyToLabel(key: string): string {
  const d = new Date(key + 'T00:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// ISO 8601 week number (Monday-start weeks, week 1 = week containing the first Thursday).
export function toWeekKey(iso: string): string {
  const d = new Date(iso)
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (date.getUTCDay() + 6) % 7 // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3) // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000))
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// Monday date (YYYY-MM-DD) that a given ISO week key starts on — used to build a
// human label like "Aug 18 – Aug 24".
export function weekKeyToLabel(key: string): string {
  const [yearStr, weekStr] = key.split('-W')
  const year = parseInt(yearStr, 10)
  const week = parseInt(weekStr, 10)
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7
  const week1Monday = new Date(jan4)
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayNum)
  const monday = new Date(week1Monday)
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${fmt(monday)} – ${fmt(sunday)}`
}

export function toMonthKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthKeyToLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function secondsToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100
}

export function hoursToHM(hours: number): string {
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

export function todayDateKey(): string {
  return toDateKey(new Date().toISOString())
}

/** Format an ISO timestamp (or YYYY-MM-DD string) as DD/MM/YYYY (four-digit year). */
export function formatDDMMYY(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  if (isNaN(d.getTime())) return '—'
  return (
    String(d.getDate()).padStart(2, '0') + '/' +
    String(d.getMonth() + 1).padStart(2, '0') + '/' +
    d.getFullYear()
  )
}

/** Format decimal hours as "00Hrs 00Min" for the spreadsheet columns. */
export function hoursToHMStr(hours: number): string {
  if (!hours || isNaN(hours)) return '00Hrs 00Min'
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}Hrs ${String(m).padStart(2, '0')}Min`
}
