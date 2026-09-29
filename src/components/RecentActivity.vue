<script setup lang="ts">
import { computed } from 'vue'
import { useTimeTrackingStore } from '../stores/timeTracking'

const store = useTimeTrackingStore()

const recentActivity = computed(() => {
  const seenIds = new Set<number>()
  const result: { issueId: number; title: string; repo: string; hours: number; state: string }[] = []
  for (const e of [...store.entries].sort((a, b) =>
    new Date(b.created).getTime() - new Date(a.created).getTime()
  )) {
    if (seenIds.has(e.issue_id)) continue
    seenIds.add(e.issue_id)
    const issue = store.issues.find(i => i.id === e.issue_id)
    if (!issue) continue
    const hours = store.entries
      .filter(x => x.issue_id === e.issue_id)
      .reduce((s, x) => s + (x.time || 0), 0) / 3600
    result.push({
      issueId: e.issue_id,
      title:   issue.title,
      repo:    issue.repository?.full_name ?? 'Unknown',
      hours:   Math.round(hours * 10) / 10,
      state:   issue.state,
    })
    if (result.length >= 5) break
  }
  return result
})
</script>

<template>
  <div class="section-card activity-card">
    <div class="sc-header">
      <div class="sc-title-group">
        <h3 class="sc-title">Recent activity</h3>
        <span class="sc-sub">Last touched issues</span>
      </div>
    </div>

    <!-- Skeleton -->
    <div v-if="store.loading && !recentActivity.length" class="activity-list">
      <div v-for="n in 4" :key="n" class="activity-skel">
        <div class="skeleton" style="width:28px;height:28px;border-radius:8px;flex-shrink:0" />
        <div style="flex:1;display:flex;flex-direction:column;gap:5px">
          <div class="skeleton" style="height:10px;width:80%;border-radius:4px" />
          <div class="skeleton" style="height:9px;width:50%;border-radius:4px" />
        </div>
      </div>
    </div>

    <!-- Empty -->
    <div v-else-if="!recentActivity.length" class="sc-empty" style="padding:24px 0">
      <v-icon size="24" color="secondary">mdi-history</v-icon>
      <p class="sc-empty__sub" style="margin-top:6px">No recent activity</p>
    </div>

    <!-- List -->
    <div v-else class="activity-list">
      <div
        v-for="(item, i) in recentActivity"
        :key="item.issueId"
        class="activity-item"
        :style="{ '--i': i }"
      >
        <div class="activity-item__icon" :class="`activity-item__icon--${item.state}`">
          <v-icon size="13">
            {{ item.state === 'open' ? 'mdi-source-pull' : 'mdi-check-circle-outline' }}
          </v-icon>
        </div>
        <div class="activity-item__body">
          <span class="activity-item__title">{{ item.title }}</span>
          <span class="activity-item__meta">
            <span class="activity-item__repo">{{ item.repo.split('/').pop() }}</span>
            <span class="activity-item__hrs">{{ item.hours }}h</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.activity-card {
  background: var(--bg-surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 18px 20px;
  transition: border-color 200ms var(--ease), box-shadow 200ms var(--ease);
}
.activity-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }

.sc-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
.sc-title-group { display: flex; flex-direction: column; gap: 2px; }
.sc-title { font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0; letter-spacing: -0.01em; }
.sc-sub   { font-size: 11.5px; color: var(--text-muted); }

.sc-empty { display: flex; flex-direction: column; align-items: center; text-align: center; }
.sc-empty__sub { font-size: 12px; color: var(--text-muted); margin: 0; }

.activity-list { display: flex; flex-direction: column; gap: 2px; }
.activity-skel { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); }

.activity-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 7px 8px; border-radius: var(--radius-lg);
  cursor: default;
  transition: background 140ms var(--ease);
  animation: rowIn 320ms var(--ease-out) both;
  animation-delay: calc(var(--i, 0) * 50ms + 80ms);
}
.activity-item:hover { background: var(--bg-surface-2); }
@keyframes rowIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }

.activity-item__icon {
  width: 28px; height: 28px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 1px;
}
.activity-item__icon--open   { background: var(--color-success-dim); color: var(--color-success); border: 1px solid rgba(var(--color-success-rgb), 0.2); }
.activity-item__icon--closed { background: var(--bg-surface-3); color: var(--text-muted); border: 1px solid var(--border); }

.activity-item__body { flex: 1; min-width: 0; }
.activity-item__title { display: block; font-size: 12px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.35; }
.activity-item__meta  { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
.activity-item__repo  { font-size: 10.5px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px; }
.activity-item__hrs   { font-size: 10.5px; font-weight: 700; color: var(--color-primary); margin-left: auto; flex-shrink: 0; }

.skeleton { background: var(--bg-surface-3); animation: shimmer 1.5s infinite linear; background-size: 200% 100%; background-image: linear-gradient(90deg, var(--bg-surface-3) 25%, var(--bg-surface-2) 50%, var(--bg-surface-3) 75%); }
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
</style>
