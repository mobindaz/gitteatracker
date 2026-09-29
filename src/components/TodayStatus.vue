<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useTimeTrackingStore } from '../stores/timeTracking'

const store = useTimeTrackingStore()

// ── Animated hour counter ──────────────────────────────────
const animHours = ref(0)
const visible   = ref(false)

function easeOut4(t: number) { return 1 - Math.pow(1 - t, 4) }

function animateTo(target: number) {
  const from = animHours.value
  const diff = target - from
  if (Math.abs(diff) < 0.001) { animHours.value = target; return }
  const t0  = performance.now()
  const dur = 900
  function step(now: number) {
    const p = Math.min((now - t0) / dur, 1)
    animHours.value = from + diff * easeOut4(p)
    if (p < 1) requestAnimationFrame(step)
    else animHours.value = target
  }
  requestAnimationFrame(step)
}

onMounted(() => {
  setTimeout(() => { visible.value = true }, 50)
  animateTo(store.todayHours)
})

// Re-animate when store updates
const hours = computed(() => store.todayHours)
let prevHours = 0
// watch-like via computed side-effect not needed — watch is cleaner
import { watch } from 'vue'
watch(hours, (h) => {
  if (h !== prevHours) { prevHours = h; animateTo(h) }
})

// ── Progress ───────────────────────────────────────────────
const target   = computed(() => store.targetHoursPerDay)
const pct      = computed(() => target.value > 0
  ? Math.min(100, (store.todayHours / target.value) * 100) : 0)

const statusColor = computed(() => {
  if (pct.value >= 100) return 'success'
  if (pct.value >= 60)  return 'primary'
  if (pct.value >= 25)  return 'warning'
  return 'muted'
})

const colorMap: Record<string, string> = {
  success: 'var(--color-success)',
  primary: 'var(--color-primary)',
  warning: 'var(--color-warning)',
  muted:   'var(--text-muted)',
}
const dimMap: Record<string, string> = {
  success: 'var(--color-success-dim)',
  primary: 'var(--color-primary-dim)',
  warning: 'var(--color-warning-dim)',
  muted:   'rgba(255,255,255,0.05)',
}
const rgbMap: Record<string, string> = {
  success: 'var(--color-success-rgb)',
  primary: 'var(--color-primary-rgb)',
  warning: 'var(--color-warning-rgb)',
  muted:   '148,163,184',
}

const cssColor = computed(() => colorMap[statusColor.value])
const cssDim   = computed(() => dimMap[statusColor.value])
const cssRgb   = computed(() => rgbMap[statusColor.value])

const statusLabel = computed(() => {
  if (pct.value >= 100) return 'Target reached!'
  if (pct.value >= 60)  return 'Good progress'
  if (pct.value >= 25)  return 'In progress'
  if (store.todayHours > 0) return 'Just started'
  return 'Not started yet'
})

const hoursLeft = computed(() => {
  const left = target.value - store.todayHours
  if (left <= 0) return null
  const h = Math.floor(left)
  const m = Math.round((left - h) * 60)
  if (h && m) return `${h}h ${m}m left`
  if (h)      return `${h}h left`
  return `${m}m left`
})

const displayH = computed(() => {
  const h = Math.floor(animHours.value)
  const m = Math.round((animHours.value - h) * 60)
  return { h: String(h).padStart(1, '0'), m: String(m).padStart(2, '0') }
})
</script>

<template>
  <div
    class="today-status"
    :class="{ 'today-status--visible': visible }"
    :style="{ '--ts-color': cssColor, '--ts-dim': cssDim, '--ts-rgb': cssRgb }"
  >
    <!-- Left: icon -->
    <div class="ts-icon-wrap">
      <div class="ts-icon">
        <v-icon size="20" :color="statusColor === 'muted' ? 'secondary' : statusColor">
          {{ pct >= 100 ? 'mdi-check-circle' : 'mdi-clock-outline' }}
        </v-icon>
      </div>
      <span v-if="pct >= 100" class="ts-done-ring" />
    </div>

    <!-- Centre: time display + bar -->
    <div class="ts-body">
      <div class="ts-top-row">
        <div class="ts-label">Today's work</div>
        <div class="ts-status-badge">
          <span class="ts-status-dot" />
          {{ statusLabel }}
        </div>
      </div>

      <div class="ts-time-row">
        <div class="ts-time">
          <span class="ts-time__h">{{ displayH.h }}</span>
          <span class="ts-time__sep">:</span>
          <span class="ts-time__m">{{ displayH.m }}</span>
          <span class="ts-time__unit">hm</span>
        </div>
        <div class="ts-meta">
          <span class="ts-entries">
            <v-icon size="11">mdi-format-list-bulleted</v-icon>
            {{ store.todayEntries }} entr{{ store.todayEntries === 1 ? 'y' : 'ies' }}
          </span>
          <span v-if="hoursLeft" class="ts-left">{{ hoursLeft }}</span>
          <span v-else class="ts-over">
            +{{ ((store.todayHours - target) > 0 ? (store.todayHours - target) : 0).toFixed(1) }}h over
          </span>
        </div>
      </div>

      <!-- Progress bar -->
      <div class="ts-track">
        <div
          class="ts-fill"
          :style="{ width: pct + '%' }"
        />
        <!-- Target marker at 100% -->
        <div class="ts-target-mark" :title="`Target: ${target}h`" />
      </div>

      <div class="ts-range-note">
        <v-icon size="11" style="opacity:.5;margin-right:3px">mdi-information-outline</v-icon>
        Always shows today's actual hours regardless of report range setting
      </div>
    </div>

    <!-- Right: target pill + pct ring -->
    <div class="ts-right">
      <div class="ts-ring-wrap">
        <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
          <circle cx="28" cy="28" r="22"
            fill="none"
            stroke="rgba(var(--ts-rgb), 0.10)"
            stroke-width="4"
          />
          <circle cx="28" cy="28" r="22"
            fill="none"
            :stroke="cssColor"
            stroke-width="4"
            stroke-linecap="round"
            :stroke-dasharray="2 * Math.PI * 22"
            :stroke-dashoffset="2 * Math.PI * 22 * (1 - pct / 100)"
            transform="rotate(-90 28 28)"
            style="transition: stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)"
          />
          <text x="28" y="32" text-anchor="middle" class="ts-ring-txt">{{ Math.round(pct) }}%</text>
        </svg>
      </div>
      <div class="ts-target-label">
        of {{ target }}h target
      </div>
    </div>
  </div>
</template>

<style scoped>
.today-status {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 22px;
  background: var(--bg-surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  position: relative;
  overflow: hidden;
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 380ms var(--ease-out), transform 380ms var(--ease-out),
              border-color 200ms var(--ease), box-shadow 200ms var(--ease);
}
.today-status--visible {
  opacity: 1;
  transform: translateY(0);
}
.today-status:hover {
  border-color: var(--ts-color);
  box-shadow: 0 0 0 1px rgba(var(--ts-rgb), 0.12), var(--shadow-sm);
}

/* Subtle left accent bar */
.today-status::before {
  content: '';
  position: absolute;
  left: 0; top: 16px; bottom: 16px;
  width: 3px;
  background: var(--ts-color);
  border-radius: 0 3px 3px 0;
  opacity: 0.8;
}

/* Glow bg */
.today-status::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 0% 50%, rgba(var(--ts-rgb), 0.05) 0%, transparent 60%);
  pointer-events: none;
}

/* ── Icon ─────────────────────────────────────────────────── */
.ts-icon-wrap {
  position: relative;
  flex-shrink: 0;
}
.ts-icon {
  width: 44px; height: 44px;
  border-radius: 14px;
  background: var(--ts-dim);
  border: 1px solid rgba(var(--ts-rgb), 0.2);
  display: flex; align-items: center; justify-content: center;
  transition: transform 240ms var(--ease-spring);
}
.today-status:hover .ts-icon {
  transform: scale(1.08) rotate(-4deg);
}
.ts-done-ring {
  position: absolute;
  inset: -5px;
  border-radius: 18px;
  border: 1.5px solid rgba(var(--ts-rgb), 0.3);
  animation: ripple-out 2.2s ease-out infinite;
  pointer-events: none;
}

/* ── Body ─────────────────────────────────────────────────── */
.ts-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ts-top-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ts-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.ts-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--ts-dim);
  border: 1px solid rgba(var(--ts-rgb), 0.2);
  font-size: 10.5px;
  font-weight: 700;
  color: var(--ts-color);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.ts-status-dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--ts-color);
  animation: pulse-scale 1.8s ease-in-out infinite;
}

/* Time display */
.ts-time-row {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
}
.ts-time {
  display: flex;
  align-items: baseline;
  gap: 1px;
}
.ts-time__h,
.ts-time__m {
  font-size: 32px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.ts-time__sep {
  font-size: 26px;
  font-weight: 900;
  color: var(--ts-color);
  line-height: 1;
  padding: 0 1px;
  opacity: 0.7;
}
.ts-time__unit {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  margin-left: 4px;
  align-self: flex-end;
  padding-bottom: 4px;
}

.ts-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-self: flex-end;
  padding-bottom: 4px;
}
.ts-entries {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11.5px;
  color: var(--text-secondary);
  font-weight: 600;
}
.ts-left {
  font-size: 11px;
  color: var(--text-muted);
}
.ts-over {
  font-size: 11px;
  color: var(--color-success);
  font-weight: 700;
}

/* Progress bar */
.ts-track {
  position: relative;
  height: 6px;
  background: rgba(var(--ts-rgb), 0.10);
  border-radius: 99px;
  overflow: visible;
}
.ts-fill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--ts-color), rgba(var(--ts-rgb), 0.6));
  transition: width 0.9s cubic-bezier(0.4, 0, 0.2, 1);
  max-width: 100%;
}
.ts-target-mark {
  position: absolute;
  right: 0; top: -4px;
  width: 2px; height: 14px;
  background: rgba(var(--ts-rgb), 0.35);
  border-radius: 1px;
}

.ts-range-note {
  display: flex;
  align-items: center;
  font-size: 10.5px;
  color: var(--text-muted);
  margin-top: 2px;
}

/* ── Right pct ring ────────────────────────────────────────── */
.ts-right {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.ts-ring-wrap {
  position: relative;
}
.ts-ring-txt {
  font-size: 11px;
  font-weight: 800;
  fill: var(--text-primary);
  font-family: 'Inter', system-ui, sans-serif;
}
.ts-target-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
  text-align: center;
}

/* ── Responsive ────────────────────────────────────────────── */
@media (max-width: 640px) {
  .today-status { flex-wrap: wrap; }
  .ts-right { display: none; }
  .ts-time__h, .ts-time__m { font-size: 26px; }
}
</style>
