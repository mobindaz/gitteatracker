<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'

const props = defineProps<{
  label:    string
  value:    string | number
  color?:   string
  icon?:    string
  loading?: boolean
  /** 0-100 optional radial progress ring */
  progress?: number
  trend?:   'up' | 'down' | 'flat'
  sub?:     string
  index?:   number
}>()

// ── Mount entrance stagger ────────────────────────────────
const visible = ref(false)
onMounted(() => {
  setTimeout(() => { visible.value = true }, 80 + (props.index ?? 0) * 70)
})

// ── Colour tokens ─────────────────────────────────────────
const colorMap: Record<string, string> = {
  primary: 'var(--color-primary)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error:   'var(--color-error)',
  info:    'var(--color-primary)',
  violet:  'var(--color-violet)',
}
const dimMap: Record<string, string> = {
  primary: 'var(--color-primary-dim)',
  success: 'var(--color-success-dim)',
  warning: 'var(--color-warning-dim)',
  error:   'var(--color-error-dim)',
  info:    'var(--color-primary-dim)',
  violet:  'var(--color-violet-dim)',
}
const rgbMap: Record<string, string> = {
  primary: 'var(--color-primary-rgb)',
  success: 'var(--color-success-rgb)',
  warning: 'var(--color-warning-rgb)',
  error:   'var(--color-error-rgb)',
  info:    'var(--color-primary-rgb)',
  violet:  '167,139,250',
}

const cssColor = computed(() => props.color ? (colorMap[props.color] ?? 'var(--text-primary)') : 'var(--text-secondary)')
const cssDim   = computed(() => props.color ? (dimMap[props.color]   ?? 'rgba(255,255,255,.06)') : 'rgba(255,255,255,.06)')
const cssRgb   = computed(() => props.color ? (rgbMap[props.color]   ?? 'var(--color-primary-rgb)') : '148,163,184')

// ── Radial ring SVG ───────────────────────────────────────
const RADIUS       = 20
const CIRCUMF      = 2 * Math.PI * RADIUS
const animProgress = ref(0)

watch(() => props.progress, (p) => {
  if (p == null) return
  // Animate from current to target
  const from = animProgress.value
  const to   = Math.max(0, Math.min(100, p))
  const dur  = 900
  const t0   = performance.now()
  function step(now: number) {
    const pct  = Math.min((now - t0) / dur, 1)
    const ease = 1 - Math.pow(1 - pct, 3)
    animProgress.value = from + (to - from) * ease
    if (pct < 1) requestAnimationFrame(step)
    else animProgress.value = to
  }
  requestAnimationFrame(step)
}, { immediate: true })

const dashOffset = computed(() =>
  CIRCUMF - (animProgress.value / 100) * CIRCUMF
)

const trendIcon = computed(() => {
  if (props.trend === 'up')   return 'mdi-trending-up'
  if (props.trend === 'down') return 'mdi-trending-down'
  return 'mdi-minus'
})
const trendColor = computed(() => {
  if (props.trend === 'up')   return 'var(--color-success)'
  if (props.trend === 'down') return 'var(--color-error)'
  return 'var(--text-muted)'
})
</script>

<template>
  <div
    class="sc"
    :class="{ 'sc--visible': visible }"
    :style="{
      '--card-color':     cssColor,
      '--card-dim':       cssDim,
      '--card-rgb':       cssRgb,
    }"
  >
    <!-- Top gradient accent bar -->
    <div v-if="color" class="sc__accent" />

    <!-- Soft glow bg -->
    <div v-if="color" class="sc__bg-glow" />

    <div class="sc__body">
      <!-- Left: icon OR radial ring -->
      <div class="sc__icon-wrap">
        <!-- Radial SVG ring (when progress is given) -->
        <svg
          v-if="progress != null"
          class="sc__ring"
          width="52" height="52"
          viewBox="0 0 52 52"
          aria-hidden="true"
        >
          <!-- Track -->
          <circle
            cx="26" cy="26" :r="RADIUS"
            fill="none"
            stroke="rgba(var(--card-rgb), 0.12)"
            stroke-width="3"
          />
          <!-- Fill -->
          <circle
            cx="26" cy="26" :r="RADIUS"
            fill="none"
            :stroke="cssColor"
            stroke-width="3"
            stroke-linecap="round"
            :stroke-dasharray="CIRCUMF"
            :stroke-dashoffset="dashOffset"
            transform="rotate(-90 26 26)"
            class="sc__ring-fill"
          />
          <!-- Icon inside ring -->
          <foreignObject x="10" y="10" width="32" height="32">
            <div xmlns="http://www.w3.org/1999/xhtml" class="sc__ring-icon">
              <v-icon v-if="icon" :icon="icon" size="14" />
            </div>
          </foreignObject>
        </svg>

        <!-- Plain icon box (no ring) -->
        <div v-else-if="icon" class="sc__icon">
          <v-icon :icon="icon" size="18" />
        </div>
      </div>

      <!-- Right: value + label + sub -->
      <div class="sc__content">
        <template v-if="loading">
          <div class="skeleton sc-skel-val" />
          <div class="skeleton sc-skel-lbl" />
        </template>
        <template v-else>
          <div class="sc__value">{{ value }}</div>
          <div class="sc__label">{{ label }}</div>
          <div v-if="sub || trend" class="sc__sub-row">
            <v-icon v-if="trend" :icon="trendIcon" size="11" :style="{ color: trendColor }" />
            <span v-if="sub" class="sc__sub">{{ sub }}</span>
          </div>
        </template>
      </div>
    </div>

    <!-- Hover shine sweep -->
    <div class="sc__shine" aria-hidden="true" />
  </div>
</template>

<style scoped>
.sc {
  position: relative;
  background: var(--bg-surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 16px 18px;
  height: 100%;
  overflow: hidden;
  opacity: 0;
  transform: translateY(14px) scale(0.97);
  transition:
    opacity     340ms var(--ease-out),
    transform   340ms var(--ease-spring),
    border-color 220ms var(--ease),
    box-shadow   220ms var(--ease);
  cursor: default;
}
.sc--visible {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.sc:hover {
  border-color: rgba(var(--card-rgb), 0.3);
  box-shadow:
    var(--shadow-md),
    0 0 20px rgba(var(--card-rgb), 0.08);
  transform: translateY(-3px) scale(1.01);
}

/* Gradient top accent */
.sc__accent {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: var(--card-color);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  opacity: 0.8;
}

/* Soft background glow */
.sc__bg-glow {
  position: absolute;
  top: -30px; right: -30px;
  width: 100px; height: 100px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(var(--card-rgb), 0.10), transparent 70%);
  pointer-events: none;
  transition: opacity 300ms ease;
}
.sc:hover .sc__bg-glow {
  opacity: 1.5;
}

/* Body layout */
.sc__body {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  position: relative;
  z-index: 1;
}

/* Radial ring */
.sc__ring {
  flex-shrink: 0;
  filter: drop-shadow(0 0 6px rgba(var(--card-rgb), 0.25));
}
.sc__ring-fill {
  transition: stroke-dashoffset 0.9s cubic-bezier(0.4, 0, 0.2, 1);
}
.sc__ring-icon {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: var(--card-color);
}

/* Plain icon box */
.sc__icon-wrap { flex-shrink: 0; }
.sc__icon {
  width: 42px; height: 42px;
  border-radius: 12px;
  background: var(--card-dim);
  border: 1px solid rgba(var(--card-rgb), 0.15);
  display: flex; align-items: center; justify-content: center;
  color: var(--card-color);
  transition: transform 240ms var(--ease-spring), box-shadow 240ms var(--ease);
}
.sc:hover .sc__icon {
  transform: scale(1.12) rotate(-5deg);
  box-shadow: 0 4px 14px rgba(var(--card-rgb), 0.25);
}

/* Value / label */
.sc__content {
  flex: 1;
  min-width: 0;
  padding-top: 2px;
}
.sc__value {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.03em;
  color: var(--card-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
  animation: countIn 400ms var(--ease-out) both;
}
@keyframes countIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.sc__label {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  white-space: nowrap;
}
.sc__sub-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}
.sc__sub {
  font-size: 10.5px;
  color: var(--text-muted);
  white-space: nowrap;
}

/* Hover shine sweep */
.sc__shine {
  position: absolute;
  top: 0; left: -80%;
  width: 50%; height: 100%;
  background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.04) 50%, transparent 60%);
  transform: skewX(-15deg);
  transition: left 0s;
  pointer-events: none;
}
.sc:hover .sc__shine {
  left: 140%;
  transition: left 0.6s ease;
}

/* Skeletons */
.sc-skel-val { height: 26px; width: 55%; border-radius: 5px; margin-bottom: 10px; }
.sc-skel-lbl { height: 10px; width: 75%; border-radius: 4px; }
</style>
