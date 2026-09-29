<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useTimeTrackingStore } from '../stores/timeTracking'
import { useAuthStore } from '../stores/auth'
import { exportGiteaWorkbook } from '../utils/excelExport'
import { toWeekKey, toMonthKey, todayDateKey, secondsToHours } from '../utils/dateUtils'

import BarChart            from '../components/BarChart.vue'
import RecentActivity      from '../components/RecentActivity.vue'
import TopRepos            from '../components/TopRepos.vue'
import WeeklyPaceGauge     from '../components/WeeklyPaceGauge.vue'
import ContributionHeatmap from '../components/ContributionHeatmap.vue'

const store = useTimeTrackingStore()
const auth  = useAuthStore()

// ── Chart view mode (shared between stat cards and bar chart) ─
const viewMode          = ref<'daily' | 'weekly' | 'monthly'>('daily')
const selectedPeriodKey = ref<string>('')

// ── Identity ──────────────────────────────────────────────────
const displayName = computed(() => auth.profile?.full_name || auth.username || '')
const initials    = computed(() =>
  displayName.value.split(' ').map((p: string) => p[0] ?? '').join('').slice(0, 2).toUpperCase()
)

// ── Refresh ───────────────────────────────────────────────────
const refreshing = ref(false)
async function refresh() {
  if (refreshing.value || store.loading) return
  refreshing.value = true
  await store.forceRefresh()
  setTimeout(() => { refreshing.value = false }, 700)
}

// ── Export ────────────────────────────────────────────────────
function exportExcel() {
  exportGiteaWorkbook({
    username:   auth.username,
    allEntries: store.entries,
    daily:      store.dailySummaries,
    weekly:     store.weeklySummaries,
    monthly:    store.monthlySummaries,
    issues:     store.issues,
  })
}

// ── Last updated ticker ───────────────────────────────────────
const lastUpdatedStr = ref('')
let luTimer: ReturnType<typeof setInterval> | null = null

function updateLastUpdated() {
  if (!store._lastFetchedAt) { lastUpdatedStr.value = ''; return }
  const secs = Math.round((Date.now() - store._lastFetchedAt) / 1000)
  if (secs < 10)    lastUpdatedStr.value = 'just now'
  else if (secs < 60)   lastUpdatedStr.value = `${secs}s ago`
  else if (secs < 3600) lastUpdatedStr.value = `${Math.floor(secs / 60)}m ago`
  else lastUpdatedStr.value = `${Math.floor(secs / 3600)}h ago`
}

onMounted(() => {
  updateLastUpdated()
  luTimer = setInterval(updateLastUpdated, 15_000)
  store.fetchAll()
})
onUnmounted(() => { if (luTimer) clearInterval(luTimer) })
watch(() => store._lastFetchedAt, updateLastUpdated)

// ── Stat card calculations ────────────────────────────────────

// TODAY
const todayHours = computed(() => store.todayHours)
const todayTarget = computed(() => store.targetHoursPerDay)
const todayProgress = computed(() =>
  todayTarget.value > 0 ? Math.min(100, (todayHours.value / todayTarget.value) * 100) : 0
)
const todayEntries = computed(() => store.todayEntries)
const todayStatus = computed(() => {
  const p = todayProgress.value
  if (p >= 100) return { label: 'Target reached', color: 'success' }
  if (p >= 75)  return { label: 'Almost there',   color: 'primary' }
  if (p >= 40)  return { label: 'In progress',    color: 'warning' }
  return               { label: 'Getting started', color: 'muted'  }
})

// THIS WEEK
const thisWeekHours = computed(() => store.currentWeekHours)
const weekTarget    = computed(() => store.targetHoursPerDay * store.workDaysPerWeek)
const weekProgress  = computed(() =>
  weekTarget.value > 0 ? Math.min(100, (thisWeekHours.value / weekTarget.value) * 100) : 0
)
const weekDays = computed(() => store.currentWeekDays)
const weekDaysWorked = computed(() => weekDays.value.filter(d => d.hours > 0 && !d.isFuture).length)

// THIS MONTH
const thisMonthKey   = computed(() => toMonthKey(new Date().toISOString()))
const thisMonthSummary = computed(() =>
  store.monthlySummaries.find(m => m.key === thisMonthKey.value)
)
const monthHours   = computed(() => thisMonthSummary.value?.hours ?? 0)
const monthTarget  = computed(() => thisMonthSummary.value?.target ?? (store.targetHoursPerDay * store.workDaysPerWeek * 4.345))
const monthProgress = computed(() =>
  monthTarget.value > 0 ? Math.min(100, (monthHours.value / monthTarget.value) * 100) : 0
)
const monthEntries   = computed(() => thisMonthSummary.value?.entries ?? 0)
const monthDaysWorked = computed(() =>
  store.dailySummaries.filter(d => d.key.startsWith(thisMonthKey.value)).length
)

// ── Animated values ───────────────────────────────────────────
function easeOut4(t: number) { return 1 - Math.pow(1 - t, 4) }
function animateTo(r: { value: number }, target: number, dur = 850) {
  const start = r.value
  const diff  = target - start
  if (Math.abs(diff) < 0.001) { r.value = target; return }
  const t0 = performance.now()
  function step(now: number) {
    const p = Math.min((now - t0) / dur, 1)
    r.value = start + diff * easeOut4(p)
    if (p < 1) requestAnimationFrame(step)
    else r.value = target
  }
  requestAnimationFrame(step)
}

const animToday = ref(0)
const animWeek  = ref(0)
const animMonth = ref(0)

function runAnimations() {
  animateTo(animToday, todayHours.value,  750)
  animateTo(animWeek,  thisWeekHours.value, 850)
  animateTo(animMonth, monthHours.value,  950)
}

onMounted(async () => {
  await store.fetchAll()
  runAnimations()
})
watch(() => store.loading, (loading) => {
  if (!loading && store.entries.length) runAnimations()
})

// Formatted display
const dispToday = computed(() => {
  const h = Math.floor(animToday.value)
  const m = Math.round((animToday.value - h) * 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
})
const dispWeek  = computed(() => animWeek.value.toFixed(1) + 'h')
const dispMonth = computed(() => animMonth.value.toFixed(1) + 'h')

// ── Sections entrance ──────────────────────────────────────────
const sectionsVisible = ref(false)
onMounted(() => { setTimeout(() => { sectionsVisible.value = true }, 120) })

watch(viewMode, () => { selectedPeriodKey.value = '' })
</script>

<template>
  <div class="dash">

    <!-- ══ ERROR ══════════════════════════════════════════════ -->
    <transition name="slide-down">
      <div v-if="store.loadError" class="dash-error">
        <v-icon size="15" color="error">mdi-alert-circle-outline</v-icon>
        <span>{{ store.loadError }}</span>
        <button class="dash-error__retry" @click="refresh">
          <v-icon size="13">mdi-refresh</v-icon> Retry
        </button>
      </div>
    </transition>

    <!-- ══ PAGE HEADER ════════════════════════════════════════ -->
    <div class="dash-header">
      <div class="dash-header__left">
        <!-- Avatar -->
        <div class="dash-avatar">
          <div class="dash-avatar__bg" />
          <div class="dash-avatar__inner">
            <v-img
              v-if="auth.profile?.avatar_url"
              :src="auth.profile.avatar_url"
              cover
              class="dash-avatar__img"
            />
            <span v-else class="dash-avatar__init">{{ initials }}</span>
          </div>
          <span class="dash-avatar__online" />
        </div>

        <!-- Identity -->
        <div class="dash-identity">
          <h2 class="dash-name">{{ displayName }}</h2>
          <div class="dash-meta">
            <span class="dash-meta__item">
              <span class="live-dot" />
              Live
            </span>
            <span class="dash-meta__sep">·</span>
            <span class="dash-meta__item">
              <v-icon size="11" style="opacity:.55">mdi-database-clock-outline</v-icon>
              {{ store.rangeDays }}d range
            </span>
            <span v-if="lastUpdatedStr" class="dash-meta__sep">·</span>
            <span v-if="lastUpdatedStr" class="dash-meta__item dash-meta__updated">
              Updated {{ lastUpdatedStr }}
            </span>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="dash-header__actions">
        <button
          class="hdr-btn"
          :class="{ 'hdr-btn--spin': refreshing || store.loading }"
          :disabled="refreshing || store.loading"
          @click="refresh"
          title="Refresh data"
        >
          <v-icon size="15">mdi-refresh</v-icon>
          <span>Refresh</span>
        </button>
        <button class="hdr-btn hdr-btn--accent" @click="exportExcel" title="Export to Excel">
          <v-icon size="15">mdi-microsoft-excel</v-icon>
          <span>Export</span>
        </button>
      </div>
    </div>

    <!-- ══ 3 STAT CARDS ═══════════════════════════════════════ -->
    <div class="kpi-row">

      <!-- ── TODAY ── -->
      <div class="kpi-card kpi-card--today" :class="{ 'kpi-card--loading': store.loading && !store.entries.length }">
        <div class="kpi-card__top">
          <div class="kpi-card__icon kpi-card__icon--today">
            <v-icon size="18" color="primary">mdi-weather-sunny</v-icon>
          </div>
          <div class="kpi-card__label">Today</div>
          <div class="kpi-card__status" :class="`kpi-status--${todayStatus.color}`">
            {{ todayStatus.label }}
          </div>
        </div>

        <div class="kpi-card__value-row">
          <template v-if="store.loading && !store.entries.length">
            <div class="skeleton" style="height:44px;width:110px;border-radius:10px" />
          </template>
          <template v-else>
            <span class="kpi-card__value">{{ dispToday }}</span>
            <span class="kpi-card__denom">/ {{ todayTarget }}h</span>
          </template>
        </div>

        <!-- Progress track -->
        <div class="kpi-card__track">
          <div
            class="kpi-card__fill kpi-card__fill--today"
            :style="{ '--p': todayProgress + '%' }"
          />
        </div>

        <div class="kpi-card__foot">
          <span class="kpi-foot__item">
            <v-icon size="11">mdi-format-list-bulleted</v-icon>
            {{ todayEntries }} entr{{ todayEntries !== 1 ? 'ies' : 'y' }}
          </span>
          <span class="kpi-foot__item">
            <v-icon size="11">mdi-percent</v-icon>
            {{ todayProgress.toFixed(0) }}%
          </span>
        </div>

        <!-- Decorative orb -->
        <div class="kpi-card__orb kpi-card__orb--today" aria-hidden="true" />
      </div>

      <!-- ── THIS WEEK ── -->
      <div class="kpi-card kpi-card--week" :class="{ 'kpi-card--loading': store.loading && !store.entries.length }">
        <div class="kpi-card__top">
          <div class="kpi-card__icon kpi-card__icon--week">
            <v-icon size="18" color="violet">mdi-calendar-week-outline</v-icon>
          </div>
          <div class="kpi-card__label">This Week</div>
          <div class="kpi-card__status kpi-status--violet">
            {{ weekDaysWorked }} day{{ weekDaysWorked !== 1 ? 's' : '' }} worked
          </div>
        </div>

        <div class="kpi-card__value-row">
          <template v-if="store.loading && !store.entries.length">
            <div class="skeleton" style="height:44px;width:110px;border-radius:10px" />
          </template>
          <template v-else>
            <span class="kpi-card__value kpi-card__value--violet">{{ dispWeek }}</span>
            <span class="kpi-card__denom">/ {{ weekTarget.toFixed(0) }}h</span>
          </template>
        </div>

        <!-- Progress track -->
        <div class="kpi-card__track">
          <div
            class="kpi-card__fill kpi-card__fill--week"
            :style="{ '--p': weekProgress + '%' }"
          />
        </div>

        <!-- Mini week bars Mon–Sun -->
        <div class="week-bars">
          <div
            v-for="day in weekDays"
            :key="day.label"
            class="week-bar"
            :class="{
              'week-bar--today':  day.isToday,
              'week-bar--future': day.isFuture,
              'week-bar--worked': day.hours > 0 && !day.isFuture,
            }"
            :title="`${day.label}: ${day.hours.toFixed(1)}h`"
          >
            <div
              class="week-bar__fill"
              :style="{ '--h': Math.min(100, (day.hours / store.targetHoursPerDay) * 100) + '%' }"
            />
            <span class="week-bar__lbl">{{ day.label.slice(0,1) }}</span>
          </div>
        </div>

        <div class="kpi-card__orb kpi-card__orb--week" aria-hidden="true" />
      </div>

      <!-- ── THIS MONTH ── -->
      <div class="kpi-card kpi-card--month" :class="{ 'kpi-card--loading': store.loading && !store.entries.length }">
        <div class="kpi-card__top">
          <div class="kpi-card__icon kpi-card__icon--month">
            <v-icon size="18" color="success">mdi-calendar-month-outline</v-icon>
          </div>
          <div class="kpi-card__label">This Month</div>
          <div class="kpi-card__status kpi-status--success">
            {{ monthDaysWorked }} day{{ monthDaysWorked !== 1 ? 's' : '' }} worked
          </div>
        </div>

        <div class="kpi-card__value-row">
          <template v-if="store.loading && !store.entries.length">
            <div class="skeleton" style="height:44px;width:110px;border-radius:10px" />
          </template>
          <template v-else>
            <span class="kpi-card__value kpi-card__value--success">{{ dispMonth }}</span>
            <span class="kpi-card__denom">/ {{ monthTarget.toFixed(0) }}h</span>
          </template>
        </div>

        <!-- Progress track -->
        <div class="kpi-card__track">
          <div
            class="kpi-card__fill kpi-card__fill--month"
            :style="{ '--p': monthProgress + '%' }"
          />
        </div>

        <div class="kpi-card__foot">
          <span class="kpi-foot__item">
            <v-icon size="11">mdi-calendar-check-outline</v-icon>
            {{ monthDaysWorked }} day{{ monthDaysWorked !== 1 ? 's' : '' }}
          </span>
          <span class="kpi-foot__item">
            <v-icon size="11">mdi-ticket-outline</v-icon>
            {{ store.issues.length }} ticket{{ store.issues.length !== 1 ? 's' : '' }}
          </span>
          <span class="kpi-foot__item">
            <v-icon size="11">mdi-percent</v-icon>
            {{ monthProgress.toFixed(0) }}%
          </span>
        </div>

        <div class="kpi-card__orb kpi-card__orb--month" aria-hidden="true" />
      </div>
    </div>

    <!-- ══ MAIN ROW: Chart + Side column ══════════════════════ -->
    <div class="dash-main-row" :class="{ 'section-visible': sectionsVisible }">

      <!-- Bar chart (takes ~65%) -->
      <div class="chart-wrapper">
        <BarChart
          v-model:view-mode="viewMode"
          v-model:selected-period-key="selectedPeriodKey"
        />
      </div>

      <!-- Side column (~35%) -->
      <div class="dash-side-col">
        <div class="side-item" :style="{ '--delay': '40ms'  }">
          <WeeklyPaceGauge />
        </div>
        <div class="side-item" :style="{ '--delay': '80ms'  }">
          <RecentActivity />
        </div>
        <div class="side-item" :style="{ '--delay': '120ms' }">
          <TopRepos />
        </div>
      </div>
    </div>

    <!-- ══ HEATMAP ════════════════════════════════════════════ -->
    <div
      class="heatmap-card"
      :class="{ 'section-visible': sectionsVisible }"
      style="--delay: 60ms"
    >
      <div class="heatmap-card__hdr">
        <div class="heatmap-card__title-grp">
          <div class="heatmap-card__icon">
            <v-icon size="14" color="success">mdi-grid</v-icon>
          </div>
          <div>
            <h3 class="heatmap-card__title">Activity heatmap</h3>
            <p class="heatmap-card__sub">Commits, comments &amp; issues — last ~6 months</p>
          </div>
        </div>
      </div>

      <div v-if="store.heatmapUnavailable" class="heatmap-na">
        <v-icon size="14" color="secondary">mdi-information-outline</v-icon>
        Heatmap disabled on this Gitea instance
        <code>ENABLE_USER_HEATMAP=false</code>
      </div>
      <ContributionHeatmap v-else :data="store.heatmapByDate" :weeks="26" />
    </div>

  </div>
</template>

<style scoped>
/* ── Page shell ─────────────────────────────────────────────── */
.dash {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  padding-bottom: 24px;
}

/* ── Error banner ───────────────────────────────────────────── */
.dash-error {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px;
  background: var(--color-error-dim);
  border: 1px solid rgba(240,102,114,.22);
  border-radius: var(--radius-xl);
  font-size: 13px; color: var(--color-error);
}
.dash-error__retry {
  margin-left: auto; display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 600; color: var(--color-error);
  background: none; border: 1px solid rgba(240,102,114,.3);
  border-radius: var(--radius-md); padding: 2px 9px; cursor: pointer;
  transition: background 120ms;
}
.dash-error__retry:hover { background: rgba(240,102,114,.1); }

/* ── Page header ────────────────────────────────────────────── */
.dash-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; flex-wrap: wrap;
}
.dash-header__left  { display: flex; align-items: center; gap: 16px; }
.dash-header__actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

/* Avatar */
.dash-avatar {
  position: relative; width: 52px; height: 52px; flex-shrink: 0;
}
.dash-avatar__bg {
  position: absolute; inset: -3px;
  border-radius: 50%;
  background: conic-gradient(var(--color-primary), var(--color-violet), var(--color-success), var(--color-primary));
  animation: spin 6s linear infinite;
  opacity: .55;
}
.dash-avatar__inner {
  position: absolute; inset: 2px;
  border-radius: 50%;
  background: var(--bg-surface-2);
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  z-index: 1;
}
.dash-avatar__img { width: 100%; height: 100%; object-fit: cover; }
.dash-avatar__init {
  font-size: 17px; font-weight: 800; color: var(--color-primary);
  letter-spacing: -0.02em;
}
.dash-avatar__online {
  position: absolute; bottom: 2px; right: 2px;
  width: 11px; height: 11px; border-radius: 50%;
  background: var(--color-success);
  border: 2px solid var(--bg-surface);
  z-index: 2;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* Identity text */
.dash-name {
  font-size: 18px; font-weight: 800; color: var(--text-primary);
  letter-spacing: -0.025em; margin: 0 0 4px;
  line-height: 1.2;
}
.dash-meta {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.dash-meta__item {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; color: var(--text-secondary);
}
.dash-meta__sep { color: var(--text-muted); font-size: 11px; }
.dash-meta__updated { color: var(--text-muted); }

/* Live dot */
.live-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--color-success);
  box-shadow: 0 0 6px var(--color-success);
  animation: pulse-scale 2s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes pulse-scale {
  0%,100% { transform: scale(1);    opacity: 1; }
  50%      { transform: scale(1.35); opacity: .7; }
}

/* Header buttons */
.hdr-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 14px;
  background: var(--bg-surface-1); border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg); color: var(--text-secondary);
  font-size: 12.5px; font-weight: 500; font-family: inherit; cursor: pointer;
  transition: background 130ms, color 130ms, transform 130ms, box-shadow 130ms;
  white-space: nowrap;
}
.hdr-btn:hover  { background: var(--bg-surface-2); color: var(--text-primary); transform: translateY(-1px); box-shadow: var(--shadow-sm); }
.hdr-btn:active { transform: scale(0.97); }
.hdr-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.hdr-btn--accent {
  background: var(--color-primary-dim); border-color: rgba(79,142,247,.25); color: var(--color-primary);
}
.hdr-btn--accent:hover { background: rgba(79,142,247,.22); }
.hdr-btn--spin .v-icon { animation: spin 0.75s linear infinite; }

/* ── 3 KPI cards ────────────────────────────────────────────── */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.kpi-card {
  position: relative; overflow: hidden;
  background: var(--bg-surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 22px 22px 18px;
  display: flex; flex-direction: column; gap: 12px;
  transition: border-color 220ms, box-shadow 220ms, transform 220ms;
  animation: slide-up 380ms var(--ease-out) both;
}
.kpi-card:nth-child(1) { animation-delay: 0ms; }
.kpi-card:nth-child(2) { animation-delay: 55ms; }
.kpi-card:nth-child(3) { animation-delay: 110ms; }
.kpi-card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
  transform: translateY(-3px);
}
@keyframes slide-up {
  from { opacity: 0; transform: translateY(16px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)    scale(1); }
}

/* Top row: icon + label + status */
.kpi-card__top {
  display: flex; align-items: center; gap: 10px;
}
.kpi-card__icon {
  width: 36px; height: 36px; flex-shrink: 0;
  border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
  transition: transform 200ms var(--ease-spring);
}
.kpi-card:hover .kpi-card__icon { transform: scale(1.1) rotate(-5deg); }
.kpi-card__icon--today { background: var(--color-primary-dim); border: 1px solid rgba(79,142,247,.2); }
.kpi-card__icon--week  { background: var(--color-violet-dim);  border: 1px solid rgba(167,139,250,.2); }
.kpi-card__icon--month { background: var(--color-success-dim); border: 1px solid rgba(61,214,140,.2); }

.kpi-card__label {
  flex: 1; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .07em;
  color: var(--text-muted);
}
.kpi-card__status {
  font-size: 10.5px; font-weight: 600; padding: 3px 9px;
  border-radius: 99px; white-space: nowrap;
}
.kpi-status--success { background: var(--color-success-dim); color: var(--color-success); }
.kpi-status--primary { background: var(--color-primary-dim); color: var(--color-primary); }
.kpi-status--warning { background: var(--color-warning-dim); color: var(--color-warning); }
.kpi-status--violet  { background: var(--color-violet-dim);  color: var(--color-violet); }
.kpi-status--muted   { background: var(--bg-surface-3);      color: var(--text-muted); }

/* Value */
.kpi-card__value-row {
  display: flex; align-items: baseline; gap: 6px;
  min-height: 48px;
}
.kpi-card__value {
  font-size: 40px; font-weight: 900; line-height: 1;
  letter-spacing: -0.04em;
  color: var(--color-primary);
  font-variant-numeric: tabular-nums;
}
.kpi-card__value--violet  { color: var(--color-violet); }
.kpi-card__value--success { color: var(--color-success); }
.kpi-card__denom {
  font-size: 14px; font-weight: 500; color: var(--text-muted);
  margin-bottom: 2px;
}

/* Progress track */
.kpi-card__track {
  height: 4px; border-radius: 99px;
  background: var(--bg-surface-3);
  overflow: hidden;
}
.kpi-card__fill {
  height: 100%; border-radius: 99px;
  width: var(--p, 0%);
  transition: width 800ms cubic-bezier(0.4, 0, 0.2, 1);
}
.kpi-card__fill--today { background: linear-gradient(90deg, var(--color-primary), #7eb6ff); }
.kpi-card__fill--week  { background: linear-gradient(90deg, var(--color-violet),  #c4b5fd); }
.kpi-card__fill--month { background: linear-gradient(90deg, var(--color-success), #6ee7b7); }

/* Footer row */
.kpi-card__foot {
  display: flex; align-items: center; gap: 14px;
}
.kpi-foot__item {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; color: var(--text-muted); font-weight: 500;
}

/* Mini week bars */
.week-bars {
  display: flex; gap: 4px; align-items: flex-end; height: 32px;
}
.week-bar {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  gap: 3px; height: 100%;
}
.week-bar__fill {
  flex: 1; width: 100%; border-radius: 3px 3px 0 0;
  background: var(--bg-surface-3);
  display: flex; align-items: flex-end; overflow: hidden;
  position: relative;
}
.week-bar__fill::after {
  content: '';
  position: absolute; bottom: 0; left: 0; right: 0;
  height: var(--h, 0%);
  background: var(--color-violet);
  border-radius: 3px 3px 0 0;
  transition: height 700ms cubic-bezier(0.4, 0, 0.2, 1);
  opacity: .6;
}
.week-bar--today  .week-bar__fill::after { background: var(--color-violet); opacity: 1; }
.week-bar--worked .week-bar__fill::after { opacity: .75; }
.week-bar--future .week-bar__fill::after { opacity: .2; }
.week-bar__lbl {
  font-size: 9px; font-weight: 600; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: .04em;
  line-height: 1;
}
.week-bar--today .week-bar__lbl { color: var(--color-violet); font-weight: 800; }

/* Decorative orbs */
.kpi-card__orb {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(40px);
  opacity: .18;
}
.kpi-card__orb--today {
  width: 100px; height: 100px;
  background: var(--color-primary);
  bottom: -30px; right: -20px;
  animation: float 7s ease-in-out infinite;
}
.kpi-card__orb--week {
  width: 90px; height: 90px;
  background: var(--color-violet);
  bottom: -25px; right: -15px;
  animation: float 8s ease-in-out infinite reverse;
}
.kpi-card__orb--month {
  width: 100px; height: 100px;
  background: var(--color-success);
  bottom: -30px; right: -20px;
  animation: float 9s ease-in-out infinite;
}
@keyframes float {
  0%,100% { transform: translateY(0px); }
  50%      { transform: translateY(-12px); }
}

/* ── Main row ────────────────────────────────────────────────── */
.dash-main-row {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 14px;
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 380ms var(--ease-out), transform 380ms var(--ease-out);
  transition-delay: var(--delay, 0ms);
}
.dash-main-row.section-visible {
  opacity: 1; transform: translateY(0);
}
.chart-wrapper {
  min-width: 0;
}
.dash-side-col {
  display: flex; flex-direction: column; gap: 14px; min-width: 0;
}
.side-item {
  opacity: 0; transform: translateX(12px);
  transition: opacity 360ms var(--ease-out), transform 360ms var(--ease-out);
  transition-delay: var(--delay, 0ms);
}
.section-visible .side-item { opacity: 1; transform: translateX(0); }

/* ── Heatmap card ────────────────────────────────────────────── */
.heatmap-card {
  background: var(--bg-surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 18px 20px 16px;
  opacity: 0; transform: translateY(10px);
  transition: opacity 380ms var(--ease-out), transform 380ms var(--ease-out),
              border-color 220ms;
  transition-delay: var(--delay, 0ms);
}
.heatmap-card.section-visible { opacity: 1; transform: translateY(0); }
.heatmap-card:hover { border-color: var(--border-strong); }

.heatmap-card__hdr {
  display: flex; align-items: flex-start; justify-content: space-between;
  margin-bottom: 14px;
}
.heatmap-card__title-grp {
  display: flex; align-items: flex-start; gap: 11px;
}
.heatmap-card__icon {
  width: 30px; height: 30px; flex-shrink: 0;
  background: var(--color-success-dim);
  border: 1px solid rgba(61,214,140,.2);
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.heatmap-card__title {
  font-size: 13.5px; font-weight: 700; color: var(--text-primary);
  margin: 0 0 3px; letter-spacing: -0.01em;
}
.heatmap-card__sub {
  font-size: 11.5px; color: var(--text-muted); margin: 0;
}
.heatmap-na {
  display: flex; align-items: center; gap: 7px;
  font-size: 12.5px; color: var(--text-secondary);
  padding: 12px; background: var(--bg-surface-2);
  border: 1px solid var(--border); border-radius: var(--radius-lg);
}

/* slide-down transition for error */
.slide-down-enter-active { transition: all 280ms var(--ease-out); }
.slide-down-leave-active { transition: all 180ms var(--ease-in); }
.slide-down-enter-from, .slide-down-leave-to {
  opacity: 0; transform: translateY(-8px);
}

/* ── Responsive ──────────────────────────────────────────────── */
@media (max-width: 1100px) {
  .dash-main-row {
    grid-template-columns: 1fr;
  }
  .dash-side-col {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
}
@media (max-width: 800px) {
  .kpi-row {
    grid-template-columns: 1fr;
  }
  .dash-side-col {
    grid-template-columns: 1fr;
  }
  .kpi-card__value { font-size: 32px; }
}
</style>
