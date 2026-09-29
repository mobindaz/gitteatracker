<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useTimeTrackingStore } from '../stores/timeTracking'

const store = useTimeTrackingStore()

const viewMode        = defineModel<'daily' | 'weekly' | 'monthly'>('viewMode', { default: 'daily' })
const selectedPeriodKey = defineModel<string>('selectedPeriodKey', { default: '' })

// ── Period options ─────────────────────────────────────────
const periodOptions = computed(() => {
  if (viewMode.value === 'weekly')  return store.weeklySummaries.map(r => ({ key: r.key, label: r.label }))
  if (viewMode.value === 'monthly') return store.monthlySummaries.map(r => ({ key: r.key, label: r.label }))
  return store.dailySummaries.map(r => ({ key: r.key, label: r.label }))
})

// Reset selection when mode changes
watch(viewMode, () => { selectedPeriodKey.value = '' })

// ── Rows ───────────────────────────────────────────────────
const rows = computed(() => {
  if (viewMode.value === 'daily')   return store.dailySummaries.slice(0, 30)
  if (viewMode.value === 'weekly')  return store.weeklySummaries.slice(0, 14)
  return store.monthlySummaries
})

const maxHours  = computed(() => Math.max(1, ...rows.value.map(r => r.hours)))
const barKey    = ref(0)
watch(viewMode, () => { barKey.value++ })

function barPct(hours: number)     { return Math.min(100, (hours / maxHours.value) * 100) }
function targetPct(target: number) { return Math.min(100, (target / maxHours.value) * 100) }

function barColor(diff: number): string {
  if (diff < -0.01) return 'var(--color-error)'
  if (diff >  0.5)  return 'var(--color-warning)'
  return 'var(--color-primary)'
}
function barGradient(diff: number): string {
  if (diff < -0.01) return 'linear-gradient(90deg, var(--color-error), rgba(240,102,114,0.6))'
  if (diff >  0.5)  return 'linear-gradient(90deg, var(--color-warning), rgba(240,164,74,0.6))'
  return 'linear-gradient(90deg, var(--color-primary), rgba(79,142,247,0.55))'
}

type DiffInfo = { text: string; cls: 'over' | 'short' | 'exact' }
function fmtDiff(diff: number): DiffInfo {
  const cls: DiffInfo['cls'] = diff < -0.005 ? 'over' : diff > 0.005 ? 'short' : 'exact'
  return { text: `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}h`, cls }
}
const diffColor: Record<string, string> = {
  over:  'var(--color-error)',
  short: 'var(--color-warning)',
  exact: 'var(--color-success)',
}
</script>

<template>
  <div class="section-card bar-chart-card">
    <!-- Header -->
    <div class="sc-header">
      <div class="sc-title-group">
        <h3 class="sc-title">Hours worked</h3>
        <span class="sc-sub">
          {{ rows.length }}&thinsp;{{ viewMode === 'daily' ? 'days' : viewMode === 'weekly' ? 'weeks' : 'months' }}
          <span v-if="store.loading" class="sc-sub-loading">
            <span class="typing-dots"><span /><span /><span /></span>
          </span>
        </span>
      </div>

      <div class="sc-header-controls">
        <!-- Daily / Weekly / Monthly tabs -->
        <div class="view-tabs">
          <button
            v-for="v in (['daily','weekly','monthly'] as const)"
            :key="v"
            class="view-tab"
            :class="{ 'view-tab--active': viewMode === v }"
            @click="viewMode = v"
          >
            {{ v[0].toUpperCase() + v.slice(1) }}
          </button>
        </div>

        <!-- Period selector (weekly / monthly) -->
        <div v-if="viewMode !== 'daily'" class="period-select-wrap">
          <v-icon size="13" class="period-select-wrap__icon">mdi-calendar-month-outline</v-icon>
          <select
            v-model="selectedPeriodKey"
            class="period-select"
            :title="`Select ${viewMode === 'weekly' ? 'week' : 'month'}`"
          >
            <option value="">
              {{ periodOptions[0]?.label ?? (viewMode === 'weekly' ? 'This week' : 'This month') }}
            </option>
            <option
              v-for="opt in periodOptions.slice(1)"
              :key="opt.key"
              :value="opt.key"
            >
              {{ opt.label }}
            </option>
          </select>
          <v-icon size="11" class="period-select-wrap__chevron">mdi-chevron-down</v-icon>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!rows.length && !store.loading" class="sc-empty">
      <div class="sc-empty__icon">
        <v-icon size="32" color="secondary">mdi-chart-bar</v-icon>
      </div>
      <p class="sc-empty__title">No data in this range</p>
      <p class="sc-empty__sub">Try expanding history in Settings.</p>
    </div>

    <!-- Skeleton bars -->
    <template v-else-if="store.loading && !rows.length">
      <div v-for="n in 8" :key="n" class="chart-row chart-row--skel">
        <div class="skeleton" style="width:72px;height:9px;border-radius:5px;flex-shrink:0" />
        <div class="chart-row__track">
          <div class="skeleton" :style="{ width: (20 + n * 8) + '%', height: '8px', borderRadius: '99px' }" />
        </div>
        <div class="skeleton" style="width:90px;height:9px;border-radius:5px;flex-shrink:0" />
      </div>
    </template>

    <!-- Live bars -->
    <div v-else :key="barKey" class="chart-body">
      <div
        v-for="(row, i) in rows"
        :key="row.key"
        class="chart-row"
        :style="{ '--i': i, '--bar-pct': barPct(row.hours) + '%' }"
      >
        <div class="chart-row__lbl">{{ row.label }}</div>

        <div class="chart-row__track">
          <div class="chart-row__fill" :style="{ background: barGradient(row.diff) }" />
          <div class="chart-row__target" :style="{ left: targetPct(row.target) + '%' }" :title="`Target: ${row.target}h`" />
          <div
            class="chart-row__tip"
            :style="{ left: barPct(row.hours) + '%', background: barColor(row.diff), boxShadow: `0 0 8px 2px ${barColor(row.diff)}` }"
          />
        </div>

        <div class="chart-row__meta">
          <span class="chart-row__hrs">{{ row.hours.toFixed(2) }}h</span>
          <span class="chart-row__ent">{{ row.entries }}x</span>
          <span class="chart-row__diff" :style="{ color: diffColor[fmtDiff(row.diff).cls] }">
            {{ fmtDiff(row.diff).text }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bar-chart-card {
  background: var(--bg-surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 22px 24px;
  transition: border-color 200ms var(--ease), box-shadow 200ms var(--ease);
}
.bar-chart-card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

/* Header */
.sc-header {
  display: flex; align-items: flex-start;
  justify-content: space-between; flex-wrap: wrap; gap: 10px;
  margin-bottom: 18px;
}
.sc-header-controls {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.sc-title-group { display: flex; flex-direction: column; gap: 2px; }
.sc-title { font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0; letter-spacing: -0.01em; }
.sc-sub { font-size: 11.5px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
.sc-sub-loading { display: inline-flex; }

/* Tabs */
.view-tabs {
  display: flex;
  background: var(--bg-surface-2);
  border: 1px solid var(--border);
  border-radius: 11px; padding: 3px; gap: 2px;
}
.view-tab {
  padding: 5px 13px; border-radius: 8px; border: none;
  background: transparent; color: var(--text-muted);
  font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: background 140ms var(--ease), color 140ms var(--ease), transform 140ms var(--ease-spring);
}
.view-tab:hover { color: var(--text-secondary); transform: scale(1.03); }
.view-tab--active { background: var(--bg-surface-3); color: var(--text-primary); box-shadow: var(--shadow-sm); }

/* Period selector */
.period-select-wrap {
  position: relative; display: flex; align-items: center;
  background: var(--bg-surface-2); border: 1px solid var(--border);
  border-radius: 11px; padding: 0 10px 0 8px;
  height: 32px; gap: 5px;
  transition: border-color 140ms var(--ease), box-shadow 140ms var(--ease);
}
.period-select-wrap:focus-within {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb), 0.15);
}
.period-select-wrap__icon, .period-select-wrap__chevron { color: var(--text-muted); flex-shrink: 0; pointer-events: none; }
.period-select {
  appearance: none; -webkit-appearance: none;
  background: transparent; border: none; outline: none;
  color: var(--text-secondary); font-size: 12px; font-weight: 600;
  font-family: inherit; cursor: pointer; padding: 0;
  max-width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.period-select option { background: var(--bg-surface-1, #1e1e2e); color: var(--text-primary); }

/* Empty */
.sc-empty { display: flex; flex-direction: column; align-items: center; padding: 48px 24px; text-align: center; gap: 6px; }
.sc-empty__icon { width: 56px; height: 56px; border-radius: 16px; background: var(--bg-surface-2); display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
.sc-empty__title { font-size: 14px; font-weight: 600; color: var(--text-secondary); margin: 0; }
.sc-empty__sub   { font-size: 12px; color: var(--text-muted); margin: 0; }

/* Chart */
.chart-body { display: flex; flex-direction: column; gap: 8px; }
.chart-row {
  display: grid;
  grid-template-columns: 100px 1fr 170px;
  align-items: center; gap: 12px;
  animation: rowIn 360ms var(--ease-out) both;
  animation-delay: calc(var(--i, 0) * 18ms);
}
.chart-row--skel { grid-template-columns: 72px 1fr 90px; }
@keyframes rowIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }

.chart-row__lbl { font-size: 11px; font-weight: 500; color: var(--text-secondary); text-align: right; white-space: nowrap; }
.chart-row__track { position: relative; height: 8px; background: rgba(var(--color-primary-rgb), 0.07); border-radius: 99px; overflow: visible; }

.chart-row__fill {
  position: absolute; left: 0; top: 0; bottom: 0;
  width: 0; border-radius: 99px;
  animation: barGrow 700ms var(--ease-out) both;
  animation-delay: calc(var(--i, 0) * 18ms + 60ms);
}
@keyframes barGrow { from { width: 0 !important; } to { width: var(--bar-pct); } }

.chart-row__tip {
  position: absolute; top: 50%; transform: translate(-50%, -50%);
  width: 8px; height: 8px; border-radius: 50%; opacity: 0;
  animation: tipAppear 300ms var(--ease-out) both;
  animation-delay: calc(var(--i, 0) * 18ms + 750ms);
}
@keyframes tipAppear { from { opacity: 0; transform: translate(-50%, -50%) scale(0); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }

.chart-row__target { position: absolute; top: -5px; width: 2px; height: 18px; background: rgba(var(--color-primary-rgb), 0.22); border-radius: 1px; transform: translateX(-1px); }

.chart-row__meta { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.chart-row__hrs  { font-weight: 700; color: var(--text-primary); min-width: 48px; font-variant-numeric: tabular-nums; }
.chart-row__ent  { color: var(--text-muted); min-width: 28px; }
.chart-row__diff { font-weight: 700; font-variant-numeric: tabular-nums; font-size: 10.5px; }

/* Skeleton */
.skeleton { background: var(--bg-surface-3); animation: shimmer 1.5s infinite linear; background-size: 200% 100%; background-image: linear-gradient(90deg, var(--bg-surface-3) 25%, var(--bg-surface-2) 50%, var(--bg-surface-3) 75%); }
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

/* Typing dots */
.typing-dots { display: inline-flex; gap: 3px; align-items: center; }
.typing-dots span { width: 4px; height: 4px; border-radius: 50%; background: var(--text-muted); animation: dot-bounce 1.2s infinite; }
.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes dot-bounce { 0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; } 40% { transform: scale(1); opacity: 1; } }

@media (max-width: 860px) {
  .chart-row { grid-template-columns: 72px 1fr; }
  .chart-row__meta { grid-column: 1 / -1; padding-left: 84px; }
}
</style>
