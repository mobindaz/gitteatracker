<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useTimeTrackingStore } from '../stores/timeTracking'

const store = useTimeTrackingStore()

const weeklyTarget  = computed(() => store.targetHoursPerDay * store.workDaysPerWeek)
const weeklyHours   = computed(() => store.currentWeekHours)
const weekDays      = computed(() => store.currentWeekDays)

const weekPct = computed(() =>
  weeklyTarget.value > 0
    ? Math.min(100, Math.round((weeklyHours.value / weeklyTarget.value) * 100))
    : 0
)

// Animated arc
const animWeekPct = ref(0)
watch(weekPct, (v) => {
  const from = animWeekPct.value
  const to   = v
  const t0   = performance.now()
  const dur  = 1000
  function step(now: number) {
    const p = Math.min((now - t0) / dur, 1)
    animWeekPct.value = from + (to - from) * (1 - Math.pow(1 - p, 3))
    if (p < 1) requestAnimationFrame(step)
    else animWeekPct.value = to
  }
  requestAnimationFrame(step)
}, { immediate: true })

// SVG arc helpers: 270° sweep starting at 135°
const ARC_R   = 42
const ARC_C   = 2 * Math.PI * ARC_R
const arcOffset = computed(() => ARC_C - (animWeekPct.value / 100) * ARC_C * 0.75)
</script>

<template>
  <div class="section-card gauge-card">
    <div class="sc-header" style="margin-bottom:10px">
      <div class="sc-title-group">
        <h3 class="sc-title">Weekly pace</h3>
        <span class="sc-sub">This week vs target</span>
      </div>
      <div
        class="gauge-pct-pill"
        :class="{
          'gauge-pct-pill--full': weekPct >= 100,
          'gauge-pct-pill--mid':  weekPct >= 50 && weekPct < 100,
          'gauge-pct-pill--low':  weekPct < 50,
        }"
      >{{ weekPct }}%</div>
    </div>

    <!-- SVG arc gauge 270° sweep -->
    <div class="gauge-wrap">
      <svg viewBox="0 0 110 82" class="gauge-svg" aria-hidden="true">
        <!-- Background track -->
        <circle
          cx="55" cy="62" :r="ARC_R"
          fill="none"
          stroke="rgba(var(--color-primary-rgb), 0.10)"
          stroke-width="8" stroke-linecap="round"
          :stroke-dasharray="`${ARC_C * 0.75} ${ARC_C}`"
          stroke-dashoffset="0"
          transform="rotate(135 55 62)"
        />
        <!-- Animated fill -->
        <circle
          cx="55" cy="62" :r="ARC_R"
          fill="none"
          :stroke="weekPct >= 100 ? 'var(--color-success)' : weekPct >= 50 ? 'var(--color-primary)' : 'var(--color-warning)'"
          stroke-width="8" stroke-linecap="round"
          :stroke-dasharray="`${ARC_C * 0.75} ${ARC_C}`"
          :stroke-dashoffset="arcOffset"
          transform="rotate(135 55 62)"
          class="gauge-arc-fill"
        />
        <!-- Centre labels -->
        <text x="55" y="57" text-anchor="middle" class="gauge-txt-main">
          {{ weeklyHours.toFixed(1) }}h
        </text>
        <text x="55" y="70" text-anchor="middle" class="gauge-txt-sub">
          / {{ weeklyTarget.toFixed(0) }}h
        </text>
      </svg>
    </div>

    <!-- Mon–Sun mini vertical bars -->
    <div class="gauge-days">
      <div
        v-for="d in weekDays"
        :key="d.label"
        class="gauge-day"
        :class="{ 'gauge-day--today': d.isToday, 'gauge-day--future': d.isFuture }"
        :title="`${d.label}: ${d.hours}h`"
      >
        <div class="gauge-day__bar-track">
          <div
            class="gauge-day__bar-fill"
            :style="{
              height: d.hours > 0
                ? Math.min(100, (d.hours / store.targetHoursPerDay) * 100) + '%'
                : '0%',
              background: d.isToday
                ? 'var(--color-primary)'
                : d.hours >= store.targetHoursPerDay
                  ? 'var(--color-success)'
                  : 'rgba(var(--color-primary-rgb), 0.45)',
            }"
          />
          <span v-if="d.isToday && d.hours > 0" class="gauge-day__pulse" />
        </div>
        <span class="gauge-day__label">{{ d.label[0] }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gauge-card {
  background: var(--bg-surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 18px 20px;
  transition: border-color 200ms var(--ease), box-shadow 200ms var(--ease);
}
.gauge-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }

.sc-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.sc-title-group { display: flex; flex-direction: column; gap: 2px; }
.sc-title { font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0; letter-spacing: -0.01em; }
.sc-sub   { font-size: 11.5px; color: var(--text-muted); }

.gauge-pct-pill {
  font-size: 11px; font-weight: 800;
  padding: 2px 9px; border-radius: var(--radius-full);
  letter-spacing: 0.02em;
}
.gauge-pct-pill--full { background: var(--color-success-dim); color: var(--color-success); border: 1px solid rgba(var(--color-success-rgb), 0.25); }
.gauge-pct-pill--mid  { background: var(--color-primary-dim); color: var(--color-primary); border: 1px solid rgba(var(--color-primary-rgb), 0.25); }
.gauge-pct-pill--low  { background: var(--color-warning-dim); color: var(--color-warning); border: 1px solid rgba(var(--color-warning-rgb), 0.25); }

.gauge-wrap { display: flex; justify-content: center; margin: 0 0 10px; }
.gauge-svg  { width: 120px; height: auto; overflow: visible; }

.gauge-arc-fill {
  transition: stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.5s ease;
  filter: drop-shadow(0 0 5px currentColor);
}

.gauge-txt-main { font-size: 13px; font-weight: 800; fill: var(--text-primary); font-family: 'Inter', system-ui, sans-serif; }
.gauge-txt-sub  { font-size: 8px;  font-weight: 500; fill: var(--text-muted);  font-family: 'Inter', system-ui, sans-serif; }

.gauge-days {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 4px; padding: 0 4px;
}
.gauge-day { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.gauge-day--future { opacity: 0.3; pointer-events: none; }

.gauge-day__bar-track {
  width: 100%; height: 36px;
  background: rgba(var(--color-primary-rgb), 0.07);
  border-radius: 4px; position: relative; overflow: visible;
  display: flex; align-items: flex-end;
}
.gauge-day__bar-fill {
  width: 100%; border-radius: 4px;
  transition: height 0.8s cubic-bezier(0.4, 0, 0.2, 1);
  animation: barGrowV 0.8s var(--ease-out) both;
}
@keyframes barGrowV { from { height: 0 !important; } }

.gauge-day__pulse {
  position: absolute; top: -5px; left: 50%;
  transform: translateX(-50%);
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--color-primary);
  box-shadow: 0 0 6px rgba(var(--color-primary-rgb), 0.7);
  animation: pulse-scale 1.6s ease-in-out infinite;
}

.gauge-day__label { font-size: 9px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.gauge-day--today .gauge-day__label { color: var(--color-primary); }
</style>
