<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  data: Record<string, number>
  weeks?: number
}>()

// ── Responsive cell size ───────────────────────────────────
// We let the grid fill the available container width instead of fixed 14px cells.
const containerRef = ref<HTMLElement | null>(null)
const containerWidth = ref(600)

let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(entries => {
    containerWidth.value = entries[0]?.contentRect.width ?? 600
  })
  if (containerRef.value) ro.observe(containerRef.value)
})
onUnmounted(() => { ro?.disconnect() })

const weeksToShow = computed(() => props.weeks ?? 26)

// Cell size = fill available width between day-label col (32px) and container
const DAY_LABEL_W = 32
const GAP         = 3
const cellSize = computed(() => {
  const available = containerWidth.value - DAY_LABEL_W - GAP
  const cols      = weeksToShow.value
  // cell = (available - gaps_between_cols) / cols
  const size = Math.floor((available - GAP * (cols - 1)) / cols)
  return Math.max(8, Math.min(16, size)) // clamp 8–16px
})

// ── Grid computation ───────────────────────────────────────
const tooltip = ref<{ key: string; count: number; x: number; y: number } | null>(null)

const grid = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const endDow = today.getDay()
  const end    = new Date(today)
  end.setDate(today.getDate() + (6 - endDow))

  const totalDays = weeksToShow.value * 7
  const start     = new Date(end)
  start.setDate(end.getDate() - totalDays + 1)

  const days: { key: string; count: number; inFuture: boolean; month: number }[] = []
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.push({ key, count: props.data[key] || 0, inFuture: d > today, month: d.getMonth() })
  }

  const columns: typeof days[] = []
  for (let i = 0; i < days.length; i += 7) columns.push(days.slice(i, i + 7))
  return columns
})

// Month labels
const monthLabels = computed(() => {
  const labels: { label: string; colIndex: number }[] = []
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  let lastMonth = -1
  grid.value.forEach((col, ci) => {
    if (col[0]) {
      const m = col[0].month
      if (m !== lastMonth) { labels.push({ label: months[m], colIndex: ci }); lastMonth = m }
    }
  })
  return labels
})

const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const maxCount = computed(() => Math.max(1, ...Object.values(props.data)))

function levelFor(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0
  const ratio = count / maxCount.value
  if (ratio > 0.75) return 4
  if (ratio > 0.50) return 3
  if (ratio > 0.25) return 2
  return 1
}

function fmtKey(key: string): string {
  const [y, m, d] = key.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`
}

function showTooltip(e: MouseEvent, key: string, count: number) {
  const rect = (e.target as HTMLElement).getBoundingClientRect()
  const wrap = containerRef.value!.getBoundingClientRect()
  tooltip.value = { key, count, x: rect.left - wrap.left + rect.width / 2, y: rect.top - wrap.top - 8 }
}
function hideTooltip() { tooltip.value = null }
</script>

<template>
  <div ref="containerRef" class="heatmap-wrap">
    <!-- Month labels aligned with grid columns -->
    <div class="heatmap-months" :style="{ paddingLeft: DAY_LABEL_W + GAP + 'px' }">
      <div
        v-for="ml in monthLabels"
        :key="ml.colIndex"
        class="month-label"
        :style="{
          position: 'absolute',
          left: DAY_LABEL_W + GAP + ml.colIndex * (cellSize + GAP) + 'px'
        }"
      >{{ ml.label }}</div>
    </div>

    <!-- Body: day labels + grid -->
    <div class="heatmap-body">
      <!-- Day labels -->
      <div class="heatmap-day-labels" :style="{ width: DAY_LABEL_W + 'px', gap: GAP + 'px' }" aria-hidden="true">
        <span
          v-for="(d, i) in dayLabels"
          :key="d"
          class="day-label"
          :style="{ height: cellSize + 'px', fontSize: Math.max(8, cellSize - 4) + 'px' }"
        >{{ i % 2 === 1 ? d[0] : '' }}</span>
      </div>

      <!-- Grid -->
      <div
        class="heatmap-grid"
        :style="{ gap: GAP + 'px' }"
        role="grid"
        aria-label="Contribution activity"
      >
        <div
          v-for="(col, ci) in grid"
          :key="ci"
          class="heatmap-col"
          :style="{ gap: GAP + 'px' }"
          role="row"
        >
          <div
            v-for="day in col"
            :key="day.key"
            class="heatmap-cell"
            :class="[`level-${levelFor(day.count)}`, { future: day.inFuture }]"
            :style="{ width: cellSize + 'px', height: cellSize + 'px', borderRadius: Math.max(2, cellSize / 5) + 'px' }"
            role="gridcell"
            :aria-label="`${fmtKey(day.key)}: ${day.count} contribution${day.count === 1 ? '' : 's'}`"
            @mouseenter="e => !day.inFuture && showTooltip(e, day.key, day.count)"
            @mouseleave="hideTooltip"
          />
        </div>
      </div>
    </div>

    <!-- Legend -->
    <div class="heatmap-legend">
      <span class="legend-label">Less</span>
      <div class="legend-cells" :style="{ gap: GAP + 'px' }">
        <div
          v-for="l in [0,1,2,3,4]"
          :key="l"
          class="heatmap-cell"
          :class="`level-${l}`"
          :style="{ width: Math.min(12, cellSize) + 'px', height: Math.min(12, cellSize) + 'px', borderRadius: '2px' }"
        />
      </div>
      <span class="legend-label">More</span>
    </div>

    <!-- Tooltip -->
    <transition name="tt">
      <div
        v-if="tooltip"
        class="heatmap-tooltip"
        :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
        aria-hidden="true"
      >
        <span class="tt-count">{{ tooltip.count }} contribution{{ tooltip.count === 1 ? '' : 's' }}</span>
        <span class="tt-date">{{ fmtKey(tooltip.key) }}</span>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.heatmap-wrap {
  position: relative;
  width: 100%;
  user-select: none;
}

/* Month labels row */
.heatmap-months {
  position: relative;
  height: 18px;
  margin-bottom: 4px;
}
.month-label {
  font-size: 10px; font-weight: 600;
  color: var(--text-muted); letter-spacing: 0.04em;
  white-space: nowrap; text-transform: uppercase;
}

/* Body */
.heatmap-body {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  width: 100%;
}

/* Day labels */
.heatmap-day-labels {
  display: flex; flex-direction: column;
  flex-shrink: 0;
  padding-top: 1px;
}
.day-label {
  display: flex; align-items: center; justify-content: flex-end;
  font-weight: 500; color: var(--text-muted);
  padding-right: 4px; white-space: nowrap;
}

/* Grid */
.heatmap-grid { display: flex; flex: 1; }
.heatmap-col  { display: flex; flex-direction: column; flex: 1; }

.heatmap-cell {
  flex-shrink: 0;
  transition: transform 80ms var(--ease), filter 80ms var(--ease);
  cursor: default;
}
.heatmap-cell:not(.future):hover {
  transform: scale(1.35);
  filter: brightness(1.3);
  z-index: 1;
  position: relative;
}
.heatmap-cell.future { opacity: 0; pointer-events: none; }

/* Level colours */
.level-0 { background: rgba(255,255,255,0.05); }
.level-1 { background: rgba(61,214,140,0.20); }
.level-2 { background: rgba(61,214,140,0.40); }
.level-3 { background: rgba(61,214,140,0.65); }
.level-4 { background: #3dd68c; box-shadow: 0 0 6px rgba(61,214,140,0.4); }

/* Legend */
.heatmap-legend {
  display: flex; align-items: center; gap: 6px;
  margin-top: 10px; justify-content: flex-end;
}
.legend-label { font-size: 10px; font-weight: 500; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.legend-cells  { display: flex; }

/* Tooltip */
.heatmap-tooltip {
  position: absolute;
  transform: translate(-50%, -100%);
  background: var(--bg-surface-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  padding: 6px 10px;
  pointer-events: none; white-space: nowrap;
  box-shadow: var(--shadow-md);
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  z-index: 10;
}
.tt-count { font-size: 12px; font-weight: 700; color: var(--text-primary); }
.tt-date  { font-size: 11px; color: var(--text-secondary); }

.tt-enter-active { transition: opacity 100ms var(--ease-out), transform 100ms var(--ease-out); }
.tt-leave-active { transition: opacity 80ms var(--ease-in); }
.tt-enter-from   { opacity: 0; transform: translate(-50%, calc(-100% + 4px)); }
.tt-leave-to     { opacity: 0; }
</style>
