<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useTimeTrackingStore } from '../stores/timeTracking'
import { useAuthStore } from '../stores/auth'
import { secondsToHours, toDateKey } from '../utils/dateUtils'

const store = useTimeTrackingStore()
const auth  = useAuthStore()

// ── Date state ─────────────────────────────────────────────
const selectedDate = ref(new Date().toISOString().split('T')[0])
const dateFrom     = ref('')
const dateTo       = ref('')
const showRange    = ref(false)

// BUG FIX: Vue cannot track mutations on a Set. Use a plain reactive number array instead.
const expandedIds = ref<number[]>([])

function isExpanded(id: number)  { return expandedIds.value.includes(id) }
function toggleExpand(id: number) {
  const idx = expandedIds.value.indexOf(id)
  if (idx === -1) expandedIds.value.push(id)
  else            expandedIds.value.splice(idx, 1)
}

// BUG FIX: Always trigger fetchAll on mount regardless of entries.length,
// because entries may be stale (0-length after a page refresh).
// The store's built-in stale-TTL guard prevents redundant network calls.
onMounted(() => {
  store.fetchAll()
})

// ── Animated stats ─────────────────────────────────────────
const animHours = ref(0)
const animTickets = ref(0)
const animEntries = ref(0)
const animAvg = ref(0)

function easeOutQuart(t: number) { return 1 - Math.pow(1 - t, 4) }
function animateTo(refVal: { value: number }, target: number, dur = 700) {
  const start = refVal.value
  const diff  = target - start
  if (Math.abs(diff) < 0.001) { refVal.value = target; return }
  const t0 = performance.now()
  function step(now: number) {
    const p = Math.min((now - t0) / dur, 1)
    refVal.value = start + diff * easeOutQuart(p)
    if (p < 1) requestAnimationFrame(step)
    else refVal.value = target
  }
  requestAnimationFrame(step)
}

// ── Format helpers ─────────────────────────────────────────
function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}
function formatTime(created: string): string {
  return new Date(created).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' })
}
function fmtH(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  if (hh === 0) return `${mm}m`
  return mm === 0 ? `${hh}h` : `${hh}h ${mm}m`
}

// ── Date presets ───────────────────────────────────────────
function setToday() {
  selectedDate.value = new Date().toISOString().split('T')[0]
  showRange.value = false
}
function setYesterday() {
  const d = new Date(); d.setDate(d.getDate() - 1)
  selectedDate.value = d.toISOString().split('T')[0]
  showRange.value = false
}
function setThisWeek() {
  const t = new Date()
  const mon = new Date(t); mon.setDate(t.getDate() - t.getDay() + 1)
  dateFrom.value = mon.toISOString().split('T')[0]
  dateTo.value   = t.toISOString().split('T')[0]
  showRange.value = true
}
function setLastWeek() {
  const t = new Date()
  const mon = new Date(t); mon.setDate(t.getDate() - t.getDay() - 6)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  dateFrom.value = mon.toISOString().split('T')[0]
  dateTo.value   = sun.toISOString().split('T')[0]
  showRange.value = true
}
function setThisMonth() {
  const t = new Date()
  const first = new Date(t.getFullYear(), t.getMonth(), 1)
  dateFrom.value = first.toISOString().split('T')[0]
  dateTo.value   = t.toISOString().split('T')[0]
  showRange.value = true
}

// ── Core computed ──────────────────────────────────────────
const filteredEntries = computed(() => {
  // Filter to only the logged-in user's entries.
  // Use username from auth store; also check profile.login as a fallback
  // since some Gitea instances return a different casing or login field.
  const me = auth.username || auth.profile?.login || ''
  let entries = me
    ? store.entries.filter(e =>
        e.user_name === me ||
        e.user_name.toLowerCase() === me.toLowerCase()
      )
    : store.entries   // no username yet — show all (loading state)
  if (showRange.value && dateFrom.value && dateTo.value) {
    const from = new Date(dateFrom.value).getTime()
    const to   = new Date(dateTo.value).getTime() + 86400000
    entries = entries.filter(e => {
      const t = new Date(e.created).getTime()
      return t >= from && t < to
    })
  } else if (selectedDate.value) {
    const target = selectedDate.value.replace(/-/g,'')
    entries = entries.filter(e => e.created.split('T')[0].replace(/-/g,'') === target)
  }
  return entries.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
})

const ticketBreakdown = computed(() => {
  const grouped = new Map<number, {
    issueId: number; issueNumber: number; title: string
    repo: string; status: string
    entries: typeof filteredEntries.value
    totalHours: number; entryCount: number
    estimateHours: number | null
  }>()

  for (const entry of filteredEntries.value) {
    const issue = store.issues.find(i => i.id === entry.issue_id)
    if (!grouped.has(entry.issue_id)) {
      grouped.set(entry.issue_id, {
        issueId:     entry.issue_id,
        issueNumber: entry.issue?.number ?? entry.issue_id,
        title:       entry.issue?.title  ?? issue?.title ?? 'Unknown',
        repo:        entry.issue?.repository?.full_name ?? issue?.repository?.full_name ?? 'Unknown',
        status:      issue?.state ?? 'unknown',
        entries:     [],
        totalHours:  0,
        entryCount:  0,
        estimateHours: issue?.total_tracked_time != null
          ? secondsToHours(issue.total_tracked_time)
          : null,
      })
    }
    const t = grouped.get(entry.issue_id)!
    t.entries.push(entry)
    t.totalHours  += secondsToHours(entry.time)
    t.entryCount++
  }
  return Array.from(grouped.values()).sort((a, b) => b.totalHours - a.totalHours)
})

const stats = computed(() => {
  const totalHours = filteredEntries.value.reduce((s, e) => s + secondsToHours(e.time), 0)
  const tickets    = ticketBreakdown.value.length
  const entries    = filteredEntries.value.length
  return {
    totalHours,
    tickets,
    entries,
    avgPerTicket: tickets > 0 ? totalHours / tickets : 0,
  }
})

// Re-animate stats whenever the filtered set changes
watch(stats, (s) => {
  animateTo(animHours,   s.totalHours,   750)
  animateTo(animTickets, s.tickets,      650)
  animateTo(animEntries, s.entries,      700)
  animateTo(animAvg,     s.avgPerTicket, 700)
}, { immediate: true })

const dailyBreakdown = computed(() => {
  if (!showRange.value || !dateFrom.value || !dateTo.value) return []
  const m = new Map<string, { date: string; hours: number; entries: number; tickets: Set<number> }>()
  for (const entry of filteredEntries.value) {
    const k = entry.created.split('T')[0]
    if (!m.has(k)) m.set(k, { date: k, hours: 0, entries: 0, tickets: new Set() })
    const d = m.get(k)!
    d.hours += secondsToHours(entry.time)
    d.entries++
    d.tickets.add(entry.issue_id)
  }
  return Array.from(m.values())
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(d => ({ date: formatDate(d.date), hours: d.hours, entries: d.entries, tickets: d.tickets.size }))
})

const maxDailyHours = computed(() => Math.max(1, ...dailyBreakdown.value.map(d => d.hours)))

// Display label
const dateLabel = computed(() => {
  if (showRange.value && dateFrom.value && dateTo.value)
    return `${formatDate(dateFrom.value)} – ${formatDate(dateTo.value)}`
  if (selectedDate.value) return formatDate(selectedDate.value)
  return 'Select a date'
})

// ── Export CSV ─────────────────────────────────────────────
function exportData() {
  let csv = 'Date,Time,Ticket,Title,Repository,Hours,Status\n'
  for (const entry of filteredEntries.value) {
    const issue = store.issues.find(i => i.id === entry.issue_id)
    csv += `"${formatDate(entry.created)}","${formatTime(entry.created)}",`
    csv += `"#${entry.issue?.number ?? entry.issue_id}","${entry.issue?.title ?? 'Unknown'}",`
    csv += `"${entry.issue?.repository?.full_name ?? 'Unknown'}",`
    csv += `"${secondsToHours(entry.time).toFixed(2)}","${issue?.state ?? 'unknown'}"\n`
  }
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: `work-${selectedDate.value || 'range'}.csv` })
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="wd">

    <!-- ── Error ─────────────────────────────────────────── -->
    <transition name="fade">
      <div v-if="store.loadError" class="wd-error">
        <v-icon size="14" color="error">mdi-alert-circle-outline</v-icon>
        <span>{{ store.loadError }}</span>
        <button class="wd-error__retry" @click="store.forceRefresh()">
          <v-icon size="13">mdi-refresh</v-icon> Retry
        </button>
      </div>
    </transition>

    <!-- ── Date panel ────────────────────────────────────── -->
    <div class="dp">
      <!-- Top row -->
      <div class="dp__top">
        <div class="dp__brand">
          <div class="dp__brandicon">
            <v-icon size="16" color="primary">mdi-calendar-clock-outline</v-icon>
          </div>
          <div>
            <h3 class="dp__title">Work Details</h3>
            <p class="dp__sub">
              <span class="dp__range">{{ dateLabel }}</span>
              <span class="dp__dot">·</span>
              <span class="dp__user">{{ auth.username }}</span>
            </p>
          </div>
        </div>
        <div class="dp__actions">
          <button class="dp-btn" @click="store.forceRefresh()">
            <v-icon size="13" :class="{ 'spin': store.loading }">mdi-refresh</v-icon>
            <span>Refresh</span>
          </button>
          <button class="dp-btn dp-btn--accent" @click="exportData">
            <v-icon size="13">mdi-download-outline</v-icon>
            <span>CSV</span>
          </button>
        </div>
      </div>

      <!-- Presets -->
      <div class="dp__presets">
        <span class="dp__preset-lbl">Jump to</span>
        <div class="dp__preset-row">
          <button
            v-for="p in [
              { l:'Today',      fn: setToday     },
              { l:'Yesterday',  fn: setYesterday },
              { l:'This week',  fn: setThisWeek  },
              { l:'Last week',  fn: setLastWeek  },
              { l:'This month', fn: setThisMonth },
            ]"
            :key="p.l"
            class="dp__preset"
            @click="p.fn"
          >{{ p.l }}</button>
        </div>
      </div>

      <!-- Date inputs -->
      <div class="dp__inputs">
        <!-- Mode toggle -->
        <div class="mode-grp">
          <button class="mode-btn" :class="{ 'mode-btn--on': !showRange }" @click="showRange = false">Single date</button>
          <button class="mode-btn" :class="{ 'mode-btn--on':  showRange }" @click="showRange = true">Date range</button>
        </div>
        <!-- Fields -->
        <div class="dp__fields">
          <div class="dp__field">
            <v-icon size="13" class="dp__field-icon">mdi-calendar-outline</v-icon>
            <input
              v-if="!showRange"
              v-model="selectedDate"
              type="date"
              class="dp__input"
            />
            <input
              v-else
              v-model="dateFrom"
              type="date"
              class="dp__input"
            />
          </div>
          <transition name="fade">
            <div v-if="showRange" class="dp__field">
              <v-icon size="13" class="dp__field-icon">mdi-calendar-outline</v-icon>
              <input v-model="dateTo" type="date" class="dp__input" />
            </div>
          </transition>
        </div>
      </div>
    </div>

    <!-- ── Stats ─────────────────────────────────────────── -->
    <div class="stats-row">
      <template v-if="store.loading && !store.entries.length">
        <div v-for="n in 4" :key="n" class="stat-skel">
          <div class="skeleton" style="width:36px;height:36px;border-radius:10px" />
          <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            <div class="skeleton" style="height:24px;width:55%" />
            <div class="skeleton" style="height:10px;width:80%" />
          </div>
        </div>
      </template>
      <template v-else>
        <div class="stat-tile" :class="store.loading ? 'stat-tile--loading' : ''" data-color="primary">
          <div class="stat-tile__icon"><v-icon size="17" color="primary">mdi-clock-outline</v-icon></div>
          <div class="stat-tile__body">
            <span class="stat-tile__val">{{ animHours.toFixed(2) }}h</span>
            <span class="stat-tile__lbl">Total hours</span>
          </div>
        </div>
        <div class="stat-tile" data-color="success">
          <div class="stat-tile__icon"><v-icon size="17" color="success">mdi-ticket-outline</v-icon></div>
          <div class="stat-tile__body">
            <span class="stat-tile__val">{{ Math.round(animTickets) }}</span>
            <span class="stat-tile__lbl">Tickets worked</span>
          </div>
        </div>
        <div class="stat-tile" data-color="info">
          <div class="stat-tile__icon"><v-icon size="17" color="info">mdi-format-list-numbered</v-icon></div>
          <div class="stat-tile__body">
            <span class="stat-tile__val">{{ Math.round(animEntries) }}</span>
            <span class="stat-tile__lbl">Time entries</span>
          </div>
        </div>
        <div class="stat-tile" data-color="warning">
          <div class="stat-tile__icon"><v-icon size="17" color="warning">mdi-chart-bar</v-icon></div>
          <div class="stat-tile__body">
            <span class="stat-tile__val">{{ animAvg.toFixed(2) }}h</span>
            <span class="stat-tile__lbl">Avg / ticket</span>
          </div>
        </div>
      </template>
    </div>

    <!-- ── Daily breakdown (range only) ───────────────────── -->
    <transition name="fade">
      <div v-if="showRange && dailyBreakdown.length > 0" class="section-card">
        <div class="sc-hdr">
          <h3 class="sc-title">Daily breakdown</h3>
          <span class="sc-badge">{{ dailyBreakdown.length }} days</span>
        </div>
        <div class="daily-tbl-wrap">
          <table class="daily-tbl">
            <thead><tr>
              <th>Date</th><th>Hours</th><th>Distribution</th>
              <th class="tr">Entries</th><th class="tr">Tickets</th>
            </tr></thead>
            <tbody>
              <tr
                v-for="(day, i) in dailyBreakdown"
                :key="day.date"
                class="daily-tbl__row"
                :style="{ '--ri': i }"
              >
                <td class="day-date">{{ day.date }}</td>
                <td class="day-hrs">{{ day.hours.toFixed(2) }}h</td>
                <td class="day-bar-cell">
                  <div class="day-bar">
                    <div
                      class="day-bar__fill"
                      :style="{ '--pct': (day.hours / maxDailyHours * 100) + '%' }"
                    />
                  </div>
                </td>
                <td class="tr day-num">{{ day.entries }}</td>
                <td class="tr day-num">{{ day.tickets }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </transition>

    <!-- ── Ticket breakdown ────────────────────────────────── -->
    <div class="section-card">
      <div class="sc-hdr">
        <h3 class="sc-title">Ticket breakdown</h3>
        <span v-if="ticketBreakdown.length" class="sc-badge">
          {{ ticketBreakdown.length }} ticket{{ ticketBreakdown.length !== 1 ? 's' : '' }}
        </span>
      </div>

      <!-- Skeleton -->
      <template v-if="store.loading && !store.entries.length">
        <div v-for="n in 4" :key="n" class="tk-skel">
          <div class="skeleton" style="height:13px;width:55%;border-radius:4px" />
          <div class="skeleton" style="height:11px;width:30%;border-radius:4px;margin-top:6px" />
        </div>
      </template>

      <!-- Empty -->
      <div v-else-if="ticketBreakdown.length === 0" class="empty">
        <div class="empty__icon">
          <v-icon size="28" color="secondary">mdi-calendar-blank-outline</v-icon>
        </div>
        <p class="empty__title">No time entries for this {{ showRange ? 'range' : 'date' }}</p>
        <p class="empty__sub">
          {{ store.loading ? 'Loading data…' : 'Try a different date or expand the history range in Dashboard settings.' }}
        </p>
      </div>

      <!-- Ticket list -->
      <div v-else class="tk-list">
        <div
          v-for="(ticket, ti) in ticketBreakdown"
          :key="ticket.issueId"
          class="tk-card"
          :style="{ '--ti': ti }"
        >
          <!-- Header -->
          <button
            class="tk-hdr"
            :aria-expanded="isExpanded(ticket.issueId)"
            @click="toggleExpand(ticket.issueId)"
          >
            <span
              class="tk-dot"
              :class="ticket.status === 'open' ? 'tk-dot--open' : 'tk-dot--closed'"
            />
            <span class="tk-num">#{{ ticket.issueNumber }}</span>
            <span class="tk-title">{{ ticket.title }}</span>
            <div class="tk-hdr-right">
              <span class="tk-repo">{{ ticket.repo }}</span>
              <span class="tk-status" :class="ticket.status === 'open' ? 'tks--open' : 'tks--closed'">
                {{ ticket.status }}
              </span>
              <span v-if="ticket.estimateHours !== null" class="tk-estimate">
                <v-icon size="11">mdi-clock-fast</v-icon>
                {{ fmtH(ticket.estimateHours) }}
              </span>
              <span class="tk-hrs">{{ fmtH(ticket.totalHours) }}</span>
              <span class="tk-cnt">{{ ticket.entryCount }} entries</span>
              <v-icon
                size="15"
                class="tk-chevron"
                :class="{ 'tk-chevron--open': isExpanded(ticket.issueId) }"
              >mdi-chevron-down</v-icon>
            </div>
          </button>

          <!-- Hours bar -->
          <div class="tk-bar">
            <div
              class="tk-bar__fill"
              :style="{ '--pct': (ticket.totalHours / ticketBreakdown[0].totalHours * 100) + '%' }"
            />
          </div>

          <!-- Expanded entries -->
          <transition name="expand">
            <div v-if="isExpanded(ticket.issueId)" class="tk-entries">
              <div class="tl">
                <div
                  v-for="(entry, ei) in ticket.entries"
                  :key="entry.id"
                  class="tl-item"
                  :style="{ '--ei': ei }"
                >
                  <div class="tl-dot" />
                  <div v-if="ei < ticket.entries.length - 1" class="tl-line" />
                  <div class="tl-body">
                    <div class="tl-meta">
                      <span class="tl-date">
                        <v-icon size="11">mdi-calendar-outline</v-icon>
                        {{ formatDate(entry.created) }}
                      </span>
                      <span class="tl-time">
                        <v-icon size="11">mdi-clock-outline</v-icon>
                        {{ formatTime(entry.created) }}
                      </span>
                    </div>
                    <span class="tl-hrs">{{ secondsToHours(entry.time).toFixed(2) }}h</span>
                  </div>
                </div>
              </div>
              <div class="tk-footer">
                <span class="tk-footer__lbl">Total for this period</span>
                <span class="tk-footer__val">{{ ticket.totalHours.toFixed(2) }}h · {{ ticket.entryCount }} entries</span>
              </div>
            </div>
          </transition>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* ── Page ─────────────────────────────────────────────────── */
.wd {
  display: flex; flex-direction: column;
  gap: 16px; width: 100%;
}

/* ── Error ────────────────────────────────────────────────── */
.wd-error {
  display: flex; align-items: center; gap: 10px; padding: 11px 15px;
  background: var(--color-error-dim); border: 1px solid rgba(240,102,114,.2);
  border-radius: var(--radius-xl); font-size: 13px; color: var(--color-error);
}
.wd-error__retry {
  margin-left: auto; display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 600; color: var(--color-error);
  background: none; border: 1px solid rgba(240,102,114,.3);
  border-radius: var(--radius-md); padding: 2px 9px; cursor: pointer;
}

/* ── Date panel ───────────────────────────────────────────── */
.dp {
  background: var(--bg-surface-1); border: 1px solid var(--border);
  border-radius: var(--radius-xl); padding: 18px 20px;
  display: flex; flex-direction: column; gap: 14px;
}
.dp__top {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
}
.dp__brand { display: flex; align-items: flex-start; gap: 11px; }
.dp__brandicon {
  width: 34px; height: 34px; flex-shrink: 0; margin-top: 2px;
  background: var(--color-primary-dim); border: 1px solid rgba(79,142,247,.2);
  border-radius: 10px; display: flex; align-items: center; justify-content: center;
}
.dp__title { font-size: 14.5px; font-weight: 700; color: var(--text-primary); margin: 0 0 3px; }
.dp__sub   { font-size: 12px; color: var(--text-secondary); margin: 0; display: flex; align-items: center; gap: 5px; }
.dp__range { font-weight: 600; color: var(--color-primary); font-family: 'JetBrains Mono',monospace; font-size: 11.5px; }
.dp__dot   { color: var(--text-muted); }
.dp__user  { color: var(--text-muted); font-size: 11.5px; }

.dp__actions { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
.dp-btn {
  display: inline-flex; align-items: center; gap: 5px;
  height: 30px; padding: 0 11px;
  background: var(--bg-surface-2); border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg); color: var(--text-secondary);
  font-size: 12px; font-weight: 500; font-family: inherit; cursor: pointer;
  transition: background 120ms, color 120ms, transform 120ms;
}
.dp-btn:hover  { background: var(--bg-surface-3); color: var(--text-primary); }
.dp-btn:active { transform: scale(0.97); }
.dp-btn--accent { background: var(--color-primary-dim); border-color: rgba(79,142,247,.25); color: var(--color-primary); }
.dp-btn--accent:hover { background: rgba(79,142,247,.2); }

/* Presets */
.dp__presets   { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.dp__preset-lbl {
  font-size: 10.5px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .06em; color: var(--text-muted); white-space: nowrap;
}
.dp__preset-row { display: flex; gap: 5px; flex-wrap: wrap; }
.dp__preset {
  display: inline-flex; align-items: center;
  padding: 4px 11px; height: 28px;
  background: var(--bg-surface-2); border: 1px solid var(--border);
  border-radius: 99px; color: var(--text-secondary);
  font-size: 11.5px; font-weight: 500; font-family: inherit; cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms, transform 120ms;
  white-space: nowrap;
}
.dp__preset:hover  { background: var(--color-primary-dim); border-color: rgba(79,142,247,.25); color: var(--color-primary); transform: translateY(-1px); }
.dp__preset:active { transform: translateY(0) scale(.97); }

/* Date inputs */
.dp__inputs { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mode-grp {
  display: flex; background: var(--bg-surface-2); border: 1px solid var(--border);
  border-radius: 11px; padding: 3px; gap: 2px; flex-shrink: 0;
}
.mode-btn {
  padding: 4px 12px; height: 28px; border: none; background: transparent;
  border-radius: 8px; color: var(--text-muted);
  font-size: 11.5px; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: background 120ms, color 120ms; white-space: nowrap;
}
.mode-btn:hover { color: var(--text-secondary); }
.mode-btn--on { background: var(--bg-surface-3); color: var(--text-primary); box-shadow: var(--shadow-sm); }

.dp__fields { display: flex; gap: 7px; flex-wrap: wrap; }
.dp__field  { position: relative; display: flex; align-items: center; }
.dp__field-icon { position: absolute; left: 9px; pointer-events: none; color: var(--text-muted); }
.dp__input {
  height: 34px; padding: 0 11px 0 28px;
  background: var(--bg-surface-2); border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg); color: var(--text-primary);
  font-size: 12.5px; font-family: 'JetBrains Mono',monospace;
  outline: none; color-scheme: dark;
  transition: border-color 200ms, box-shadow 200ms;
}
.dp__input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(79,142,247,.12); }

/* Spin */
.spin { animation: spin-kf .75s linear infinite; }
@keyframes spin-kf { to { transform: rotate(360deg); } }

/* ── Stats row ────────────────────────────────────────────── */
.stats-row {
  display: grid; grid-template-columns: repeat(4,1fr); gap: 11px;
}
.stat-skel {
  background: var(--bg-surface-1); border: 1px solid var(--border);
  border-radius: var(--radius-xl); padding: 16px;
  display: flex; align-items: flex-start; gap: 11px;
}
.stat-tile {
  display: flex; align-items: flex-start; gap: 13px;
  padding: 17px 18px;
  background: var(--bg-surface-1); border: 1px solid var(--border);
  border-radius: var(--radius-xl); position: relative; overflow: hidden;
  transition: border-color 200ms, box-shadow 200ms, transform 200ms;
}
.stat-tile:hover { border-color: var(--border-strong); box-shadow: var(--shadow-md); transform: translateY(-2px); }
.stat-tile::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
}
.stat-tile[data-color="primary"]::before { background: var(--color-primary); }
.stat-tile[data-color="success"]::before { background: var(--color-success); }
.stat-tile[data-color="info"]::before    { background: var(--color-info); }
.stat-tile[data-color="warning"]::before { background: var(--color-warning); }

.stat-tile__icon {
  width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transition: transform 200ms var(--ease-spring);
}
.stat-tile:hover .stat-tile__icon { transform: scale(1.1) rotate(-4deg); }
.stat-tile[data-color="primary"] .stat-tile__icon { background: var(--color-primary-dim); }
.stat-tile[data-color="success"] .stat-tile__icon { background: var(--color-success-dim); }
.stat-tile[data-color="info"]    .stat-tile__icon { background: var(--color-info-dim); }
.stat-tile[data-color="warning"] .stat-tile__icon { background: var(--color-warning-dim); }

.stat-tile__body  { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.stat-tile__val   {
  font-size: 22px; font-weight: 800; color: var(--text-primary);
  letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums;
}
.stat-tile__lbl   {
  font-size: 10.5px; font-weight: 600; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: .06em;
}

/* ── Section card ─────────────────────────────────────────── */
.section-card {
  background: var(--bg-surface-1); border: 1px solid var(--border);
  border-radius: var(--radius-xl); padding: 18px 20px;
  transition: border-color 200ms;
}
.section-card:hover { border-color: var(--border-strong); }
.sc-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; gap: 8px; }
.sc-title { font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0; letter-spacing: -.01em; }
.sc-badge {
  padding: 2px 10px; border-radius: 99px; font-size: 11px; font-weight: 700;
  background: var(--color-primary-dim); border: 1px solid rgba(79,142,247,.2); color: var(--color-primary);
}

/* ── Daily table ──────────────────────────────────────────── */
.daily-tbl-wrap { border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.daily-tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.daily-tbl thead tr { background: var(--bg-surface-2); border-bottom: 1px solid var(--border); }
.daily-tbl thead th {
  padding: 8px 13px; font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); text-align: left;
}
.daily-tbl thead th.tr { text-align: right; }
.daily-tbl__row {
  border-bottom: 1px solid var(--border);
  transition: background 100ms;
  animation: rowIn 280ms var(--ease-out) both;
  animation-delay: calc(var(--ri,0) * 18ms);
}
.daily-tbl__row:last-child { border-bottom: none; }
.daily-tbl__row:hover { background: rgba(255,255,255,.02); }
@keyframes rowIn {
  from { opacity:0; transform: translateY(3px); }
  to   { opacity:1; transform: translateY(0); }
}
.daily-tbl td { padding: 9px 13px; }
.day-date { font-family: 'JetBrains Mono',monospace; font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
.day-hrs  { font-size: 12.5px; font-weight: 700; color: var(--color-primary); white-space: nowrap; font-family: 'JetBrains Mono',monospace; }
.day-bar-cell { width: 180px; }
.day-bar  { height: 5px; background: rgba(255,255,255,.05); border-radius: 99px; overflow: hidden; }
.day-bar__fill {
  height: 100%; background: var(--color-primary); border-radius: 99px;
  animation: barGrow 500ms var(--ease-out) both;
  animation-delay: calc(var(--ri,0) * 18ms);
}
@keyframes barGrow { from { width: 0 !important; } to { width: var(--pct); } }
.day-num { font-size: 12px; color: var(--text-secondary); font-family: 'JetBrains Mono',monospace; }
.tr { text-align: right; }

/* ── Ticket skeleton ─────────────────────────────────────── */
.tk-skel {
  padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-lg); margin-bottom: 8px;
}

/* ── Empty state ──────────────────────────────────────────── */
.empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 48px 24px; gap: 8px; text-align: center;
}
.empty__icon {
  width: 52px; height: 52px; border-radius: var(--radius-xl);
  background: var(--bg-surface-2); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center; margin-bottom: 8px;
}
.empty__title { font-size: 14px; font-weight: 600; color: var(--text-secondary); margin: 0; }
.empty__sub   { font-size: 12.5px; color: var(--text-muted); margin: 0; max-width: 340px; }

/* ── Ticket list ──────────────────────────────────────────── */
.tk-list { display: flex; flex-direction: column; gap: 8px; }
.tk-card {
  border: 1px solid var(--border); border-radius: var(--radius-lg);
  background: var(--bg-surface-2); overflow: hidden;
  transition: border-color 120ms;
  animation: tkIn 260ms var(--ease-out) both;
  animation-delay: calc(var(--ti,0) * 35ms);
}
.tk-card:hover { border-color: var(--border-strong); }
@keyframes tkIn { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }

/* Ticket header */
.tk-hdr {
  display: flex; align-items: center; gap: 9px;
  width: 100%; padding: 12px 14px;
  background: none; border: none; cursor: pointer; text-align: left;
  transition: background 100ms;
}
.tk-hdr:hover { background: rgba(255,255,255,.02); }

.tk-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  transition: box-shadow 300ms;
}
.tk-dot--open   { background: var(--color-success); box-shadow: 0 0 0 0 rgba(61,214,140,.5); animation: pulseDot 2s infinite; }
.tk-dot--closed { background: var(--text-muted); }
@keyframes pulseDot {
  0%   { box-shadow: 0 0 0 0   rgba(61,214,140,.4); }
  70%  { box-shadow: 0 0 0 6px rgba(61,214,140,0); }
  100% { box-shadow: 0 0 0 0   rgba(61,214,140,0); }
}

.tk-num   { font-family: 'JetBrains Mono',monospace; font-size: 11.5px; font-weight: 700; color: var(--color-primary); flex-shrink: 0; }
.tk-title {
  flex: 1; font-size: 13px; font-weight: 500; color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.tk-hdr-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; flex-wrap: wrap; }
.tk-repo   { font-size: 11px; color: var(--text-muted); white-space: nowrap; max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.tk-status { padding: 2px 8px; border-radius: 99px; font-size: 10.5px; font-weight: 600; white-space: nowrap; }
.tks--open   { background: rgba(61,214,140,.1); color: var(--color-success); border: 1px solid rgba(61,214,140,.2); }
.tks--closed { background: rgba(124,135,148,.1); color: var(--text-secondary); border: 1px solid rgba(124,135,148,.18); }
.tk-hrs  { font-size: 13px; font-weight: 700; color: var(--text-primary); white-space: nowrap; font-variant-numeric: tabular-nums; }
.tk-cnt  { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.tk-estimate {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600;
  white-space: nowrap;
  background: rgba(167,139,250,.1); color: #a78bfa;
  border: 1px solid rgba(167,139,250,.2);
}
.tk-chevron {
  color: var(--text-muted);
  transition: transform 250ms var(--ease-spring);
}
.tk-chevron--open { transform: rotate(180deg); }

/* Hours bar */
.tk-bar { height: 2px; background: rgba(255,255,255,.04); }
.tk-bar__fill {
  height: 100%; border-radius: 0 2px 2px 0;
  background: linear-gradient(90deg, var(--color-primary), #a78bfa);
  transition: width 600ms var(--ease-out);
  animation: barGrow2 600ms var(--ease-out) both;
}
@keyframes barGrow2 { from { width: 0 !important; } to { width: var(--pct); } }

/* Entries panel */
.tk-entries {
  border-top: 1px solid var(--border);
  padding: 12px 14px;
  background: var(--bg-surface-1);
}

/* Timeline */
.tl { display: flex; flex-direction: column; }
.tl-item {
  display: flex; align-items: flex-start; gap: 11px;
  position: relative; padding: 5px 0;
  animation: tlIn 200ms var(--ease-out) both;
  animation-delay: calc(var(--ei,0) * 25ms);
}
@keyframes tlIn { from { opacity:0; transform: translateX(-4px); } to { opacity:1; transform: translateX(0); } }

.tl-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--color-primary); border: 2px solid var(--bg-surface-2);
  flex-shrink: 0; margin-top: 4px; position: relative; z-index: 1;
  box-shadow: 0 0 6px rgba(79,142,247,.4);
}
.tl-line {
  position: absolute; left: 3px; top: 17px; bottom: -5px;
  width: 2px; background: var(--border); z-index: 0;
}
.tl-body {
  flex: 1; display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding-bottom: 5px;
  border-bottom: 1px solid var(--border);
}
.tl-item:last-child .tl-body { border-bottom: none; }
.tl-meta { display: flex; align-items: center; gap: 12px; }
.tl-date,.tl-time {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11.5px; font-family: 'JetBrains Mono',monospace; color: var(--text-secondary);
}
.tl-hrs { font-size: 12.5px; font-weight: 700; color: var(--text-primary); font-family: 'JetBrains Mono',monospace; white-space: nowrap; }

.tk-footer {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border);
}
.tk-footer__lbl { font-size: 11.5px; color: var(--text-muted); }
.tk-footer__val { font-size: 12.5px; font-weight: 700; color: var(--text-primary); }

/* ── Expand transition ────────────────────────────────────── */
.expand-enter-active { transition: all 250ms var(--ease-out); overflow: hidden; }
.expand-leave-active { transition: all 180ms var(--ease-in); overflow: hidden; }
.expand-enter-from   { opacity: 0; max-height: 0; }
.expand-enter-to     { opacity: 1; max-height: 800px; }
.expand-leave-from   { opacity: 1; max-height: 800px; }
.expand-leave-to     { opacity: 0; max-height: 0; }

/* ── Fade ─────────────────────────────────────────────────── */
.fade-enter-active,.fade-leave-active { transition: opacity 200ms var(--ease); }
.fade-enter-from,.fade-leave-to       { opacity: 0; }

/* ── Responsive ───────────────────────────────────────────── */
@media (max-width: 860px)  { .stats-row { grid-template-columns: repeat(2,1fr); } }
@media (max-width: 700px)  {
  .tk-repo,.tk-cnt { display: none; }
  .dp { padding: 14px 15px; }
}
@media (max-width: 520px)  {
  .stats-row { grid-template-columns: repeat(2,1fr); gap: 9px; }
  .tk-status { display: none; }
  .dp__preset-row { gap: 4px; }
  .dp__preset { font-size: 11px; padding: 3px 9px; }
}

/* ── Sheets button ─────────────────────────────────────────── */
.dp-btn--sheets {
  background: rgba(52,168,83,.12);
  border-color: rgba(52,168,83,.25);
  color: #34a853;
}
.dp-btn--sheets:hover {
  background: rgba(52,168,83,.2);
  color: #34a853;
}

/* ── Google Sheets dialog ─────────────────────────────────── */
.gs-dialog {
  background: var(--bg-surface-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl);
  padding: 22px 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: var(--shadow-xl);
  max-height: 90vh;
  overflow-y: auto;
}

/* Header */
.gs-hdr {
  display: flex; align-items: flex-start; gap: 13px;
}
.gs-hdr__icon {
  width: 38px; height: 38px; flex-shrink: 0;
  border-radius: 11px;
  background: rgba(52,168,83,.12);
  border: 1px solid rgba(52,168,83,.22);
  display: flex; align-items: center; justify-content: center;
}
.gs-hdr__text { flex: 1; min-width: 0; }
.gs-hdr__title {
  font-size: 15px; font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 3px; letter-spacing: -0.01em;
}
.gs-hdr__sub {
  font-size: 12px; color: var(--text-muted); margin: 0;
}
.gs-close {
  width: 28px; height: 28px; flex-shrink: 0;
  border: 1px solid var(--border); background: none;
  border-radius: 8px; color: var(--text-muted); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 120ms, color 120ms;
}
.gs-close:hover:not(:disabled) { background: var(--bg-surface-3); color: var(--text-primary); }
.gs-close:disabled { opacity: .4; cursor: not-allowed; }

/* Info banner */
.gs-info {
  display: flex; align-items: flex-start; gap: 9px;
  padding: 10px 13px;
  background: var(--color-info-dim);
  border: 1px solid rgba(79,142,247,.18);
  border-radius: var(--radius-lg);
  font-size: 12px; color: var(--text-secondary); line-height: 1.55;
}
.gs-link {
  color: var(--color-primary); font-weight: 600;
  text-decoration: none;
}
.gs-link:hover { text-decoration: underline; }

/* Form */
.gs-form { display: flex; flex-direction: column; gap: 14px; }

.gs-field { display: flex; flex-direction: column; gap: 5px; }
.gs-label {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 700; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: .06em;
}
.gs-toggle-token {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10.5px; font-weight: 600; color: var(--text-muted);
  background: none; border: none; cursor: pointer; padding: 0;
  font-family: inherit; text-transform: none; letter-spacing: 0;
  transition: color 120ms;
}
.gs-toggle-token:hover { color: var(--text-primary); }

.gs-input {
  height: 36px; padding: 0 12px;
  background: var(--bg-surface-1);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  font-size: 13px; font-family: inherit; outline: none;
  transition: border-color 200ms, box-shadow 200ms;
}
.gs-input::placeholder { color: var(--text-muted); }
.gs-input:focus {
  border-color: rgba(52,168,83,.5);
  box-shadow: 0 0 0 3px rgba(52,168,83,.1);
}
.gs-input:disabled { opacity: .5; cursor: not-allowed; }
.gs-input--mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; }

.gs-textarea {
  height: auto;
  min-height: 72px;
  resize: vertical;
  padding: 9px 12px;
  line-height: 1.5;
  font-size: 11.5px;
}

.gs-hint {
  font-size: 11px; color: var(--text-muted); margin: 0; line-height: 1.4;
}

/* Column preview */
.gs-cols-preview {
  display: flex; flex-direction: column; gap: 7px;
  padding: 13px 14px;
  background: var(--bg-surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.gs-cols-lbl {
  font-size: 10.5px; font-weight: 700; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: .06em; margin: 0;
}
.gs-cols-list {
  display: flex; flex-wrap: wrap; gap: 5px;
}
.gs-col-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px;
  background: var(--bg-surface-2);
  border: 1px solid var(--border);
  border-radius: 99px;
  font-size: 11px; color: var(--text-secondary);
}
.gs-col-chip__letter {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px; font-weight: 800;
  color: #34a853;
  background: rgba(52,168,83,.1);
  border-radius: 4px;
  padding: 0 4px;
  line-height: 1.6;
}

/* Progress */
.gs-progress {
  display: flex; flex-direction: column; gap: 7px;
}
.gs-progress__bar-track {
  height: 4px;
  background: var(--bg-surface-3);
  border-radius: 99px;
  overflow: hidden;
}
.gs-progress__bar-fill {
  height: 100%; border-radius: 99px;
  background: #34a853;
  transition: width 400ms var(--ease-out);
}
.gs-prog--signing_in { width: 15%; animation: gs-indeterminate 1.4s ease-in-out infinite; }
.gs-prog--validating { width: 20%; animation: gs-indeterminate 1.4s ease-in-out infinite; }
.gs-prog--reading    { width: 40%; animation: gs-indeterminate 1.4s ease-in-out infinite; }
.gs-prog--clearing   { width: 45%; animation: gs-indeterminate 1.4s ease-in-out infinite; }
.gs-prog--writing    { width: 75%; animation: gs-indeterminate 1.4s ease-in-out infinite; }
.gs-prog--formatting { width: 90%; animation: gs-indeterminate 1.4s ease-in-out infinite; }
.gs-prog--done       { width: 100%; animation: none; }
.gs-prog--error      { width: 100%; background: var(--color-error); animation: none; }

@keyframes gs-indeterminate {
  0%   { transform: translateX(-100%); }
  50%  { transform: translateX(0%); }
  100% { transform: translateX(100%); }
}

.gs-progress__meta {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.gs-progress__stage {
  font-size: 10.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .06em; color: #34a853;
}
.gs-progress__msg {
  font-size: 12px; color: var(--text-secondary); text-align: right;
}

/* Success */
.gs-success {
  display: flex; align-items: center; gap: 9px;
  padding: 11px 14px;
  background: rgba(52,168,83,.1);
  border: 1px solid rgba(52,168,83,.22);
  border-radius: var(--radius-lg);
  font-size: 13px; font-weight: 600; color: #34a853;
}
.gs-success__text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.gs-success__skipped {
  font-size: 11px; font-weight: 500; color: rgba(52,168,83,.7);
}
.gs-open-link {
  margin-left: auto; flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 700; color: #34a853;
  text-decoration: none; padding: 3px 10px;
  border: 1px solid rgba(52,168,83,.3);
  border-radius: 99px; background: rgba(52,168,83,.1);
  transition: background 120ms;
}
.gs-open-link:hover { background: rgba(52,168,83,.2); }

/* Error */
.gs-error {
  display: flex; align-items: flex-start; gap: 9px;
  padding: 11px 14px;
  background: var(--color-error-dim);
  border: 1px solid rgba(240,102,114,.22);
  border-radius: var(--radius-lg);
  font-size: 12.5px; color: var(--color-error); line-height: 1.5;
}

/* Footer */
.gs-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding-top: 4px;
}
.gs-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 18px;
  border-radius: var(--radius-lg);
  font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: background 130ms, opacity 130ms, transform 130ms;
  white-space: nowrap;
}
.gs-btn:active { transform: scale(0.97); }
.gs-btn:disabled { opacity: .45; cursor: not-allowed; transform: none; }
.gs-btn--ghost {
  background: var(--bg-surface-1);
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
}
.gs-btn--ghost:hover:not(:disabled) { background: var(--bg-surface-3); color: var(--text-primary); }
.gs-btn--primary {
  background: rgba(52,168,83,.15);
  border: 1px solid rgba(52,168,83,.3);
  color: #34a853;
}
.gs-btn--primary:hover:not(:disabled) { background: rgba(52,168,83,.25); }

.gs-spin { animation: spin-kf .75s linear infinite; }
</style>
