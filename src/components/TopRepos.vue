<script setup lang="ts">
import { computed } from 'vue'
import { useTimeTrackingStore } from '../stores/timeTracking'

const store = useTimeTrackingStore()

const topRepos = computed(() => {
  const map = new Map<string, number>()
  for (const issue of store.issues) {
    const repo  = issue.repository?.full_name ?? 'Unknown'
    const hours = store.entries
      .filter(e => e.issue_id === issue.id)
      .reduce((s, e) => s + (e.time || 0), 0) / 3600
    map.set(repo, (map.get(repo) ?? 0) + hours)
  }
  const sorted = Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  const max = sorted[0]?.[1] ?? 1
  return sorted.map(([repo, hours]) => ({
    repo,
    hours:  Math.round(hours * 10) / 10,
    pct:    Math.round((hours / max) * 100),
    short:  repo.split('/').pop() ?? repo,
  }))
})
</script>

<template>
  <div class="section-card repos-card">
    <div class="sc-header">
      <div class="sc-title-group">
        <h3 class="sc-title">Top repositories</h3>
        <span class="sc-sub">By hours tracked</span>
      </div>
    </div>

    <div v-if="!topRepos.length && !store.loading" class="sc-empty" style="padding:20px 0">
      <v-icon size="22" color="secondary">mdi-source-repository</v-icon>
      <p class="sc-empty__sub" style="margin-top:6px">No repos yet</p>
    </div>

    <div v-else class="repo-list">
      <div
        v-for="(r, i) in topRepos"
        :key="r.repo"
        class="repo-item"
        :style="{ '--i': i, '--pct': r.pct + '%' }"
      >
        <div class="repo-item__head">
          <div class="repo-item__icon">
            <v-icon size="12">mdi-source-repository</v-icon>
          </div>
          <span class="repo-item__name" :title="r.repo">{{ r.short }}</span>
          <span class="repo-item__hrs">{{ r.hours }}h</span>
        </div>
        <div class="repo-item__track">
          <div class="repo-item__fill" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.repos-card {
  background: var(--bg-surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 18px 20px;
  transition: border-color 200ms var(--ease), box-shadow 200ms var(--ease);
}
.repos-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }

.sc-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
.sc-title-group { display: flex; flex-direction: column; gap: 2px; }
.sc-title { font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0; letter-spacing: -0.01em; }
.sc-sub   { font-size: 11.5px; color: var(--text-muted); }

.sc-empty { display: flex; flex-direction: column; align-items: center; text-align: center; }
.sc-empty__sub { font-size: 12px; color: var(--text-muted); margin: 0; }

.repo-list { display: flex; flex-direction: column; gap: 10px; }

.repo-item {
  animation: rowIn 320ms var(--ease-out) both;
  animation-delay: calc(var(--i, 0) * 55ms + 80ms);
}
@keyframes rowIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }

.repo-item__head { display: flex; align-items: center; gap: 7px; margin-bottom: 5px; }
.repo-item__icon {
  width: 22px; height: 22px; border-radius: 6px;
  background: var(--color-primary-dim);
  border: 1px solid rgba(var(--color-primary-rgb), 0.15);
  display: flex; align-items: center; justify-content: center;
  color: var(--color-primary); flex-shrink: 0;
}
.repo-item__name { font-size: 12px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
.repo-item__hrs  { font-size: 11px; font-weight: 700; color: var(--color-primary); flex-shrink: 0; font-variant-numeric: tabular-nums; }

.repo-item__track { height: 5px; border-radius: 99px; background: rgba(var(--color-primary-rgb), 0.10); overflow: hidden; }
.repo-item__fill {
  height: 100%; border-radius: 99px; width: 0;
  background: linear-gradient(90deg, var(--color-primary), rgba(var(--color-primary-rgb), 0.55));
  animation: barGrow 800ms var(--ease-out) both;
  animation-delay: calc(var(--i, 0) * 55ms + 120ms);
  --bar-pct: var(--pct);
}
@keyframes barGrow { from { width: 0 !important; } to { width: var(--bar-pct); } }
</style>
