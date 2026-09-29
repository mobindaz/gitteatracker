<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { useAuthStore } from './stores/auth'
import { useTimeTrackingStore } from './stores/timeTracking'

const route     = useRoute()
const router    = useRouter()
const auth      = useAuthStore()
const timeStore = useTimeTrackingStore()
const theme     = useTheme()

// ── Clock (updates every second) ──────────────────────────
const clockStr = ref('')
let clockTimer: ReturnType<typeof setInterval> | null = null
let stopwatchTimer: ReturnType<typeof setInterval> | null = null

function updateClock() {
  const now = new Date()
  clockStr.value = now.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

// ── Refresh ────────────────────────────────────────────────
const refreshing = ref(false)
async function topbarRefresh() {
  if (refreshing.value) return
  refreshing.value = true
  await timeStore.forceRefresh?.()
  setTimeout(() => { refreshing.value = false }, 800)
}

// ── Theme ──────────────────────────────────────────────────
const isDark = computed(() => theme.global.name.value === 'giteaDark')
function toggleTheme() {
  theme.global.name.value = isDark.value ? 'giteaLight' : 'giteaDark'
}
watch(isDark, dark => {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
}, { immediate: true })

// ── Drawer ─────────────────────────────────────────────────
const isMobile = ref(false)
const drawer   = ref(true)
const rail     = ref(false)
function checkMobile() {
  isMobile.value = window.innerWidth < 960
  drawer.value   = !isMobile.value
}

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
  updateClock()
  clockTimer = setInterval(updateClock, 1000)
  // Poll stopwatches every 30 s so the topbar stays in sync
  stopwatchTimer = setInterval(() => { timeStore.refreshStopwatches?.() }, 30_000)
  // Also fetch immediately once auth is ready
  if (auth.isAuthenticated) timeStore.refreshStopwatches?.()
})
onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  if (clockTimer) clearInterval(clockTimer)
  if (stopwatchTimer) clearInterval(stopwatchTimer)
})

// ── Nav items ──────────────────────────────────────────────
const navItems = [
  { title: 'Dashboard',     icon: 'mdi-view-dashboard-outline', iconActive: 'mdi-view-dashboard',    to: '/dashboard' },
  { title: 'Work Details',  icon: 'mdi-calendar-clock-outline',  iconActive: 'mdi-calendar-clock',     to: '/work-details' },
  { title: 'Sheets Export', icon: 'mdi-google-spreadsheet',      iconActive: 'mdi-google-spreadsheet', to: '/sheets-export' },
]

const pageTitle   = computed(() => navItems.find(n => n.to === route.path)?.title ?? 'Gitea Time Tracker')
const serverHost  = computed(() => auth.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''))
const displayName = computed(() => auth.profile?.full_name || auth.username || '')
const initials    = computed(() =>
  displayName.value.split(' ').map((p: string) => p[0] ?? '').join('').slice(0, 2).toUpperCase()
)

function logout() {
  auth.logout()
  router.push('/login')
}

// ── Settings ───────────────────────────────────────────────
const settingsOpen  = ref(false)
const prevRangeDays = ref(timeStore.rangeDays)
watch(settingsOpen, open => { if (open) prevRangeDays.value = timeStore.rangeDays })
function saveSettings() {
  const changed = timeStore.rangeDays !== prevRangeDays.value
  timeStore.persistSettings()
  settingsOpen.value = false
  if (changed) timeStore.forceRefresh()
}

// ── Topbar user menu ───────────────────────────────────────
const userMenuOpen = ref(false)

// ── Sidebar nav mount animation ────────────────────────────
const navMounted = ref(false)
onMounted(() => { setTimeout(() => { navMounted.value = true }, 200) })

// ── Active stopwatch from official Gitea API ───────────────
// Uses GET /user/stopwatches — the correct endpoint for a RUNNING timer.
// Gitea only returns a stopwatch when "Start timer" has been pressed on an issue.
// `seconds` = total elapsed seconds since the timer was started.
const runningStopwatch = computed(() => {
  if (!timeStore.stopwatches?.length) return null
  // Return the first (and usually only) running stopwatch
  return timeStore.stopwatches[0]
})

// Ticking elapsed string based on stopwatch.seconds + wall-clock drift.
// `clockStr` is a dep so this recomputes every second.
const stopwatchElapsed = computed(() => {
  void clockStr.value // force recompute every second
  const sw = runningStopwatch.value
  if (!sw) return ''
  const startedAt = new Date(sw.created).getTime()
  const diffSec   = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const h = Math.floor(diffSec / 3600)
  const m = Math.floor((diffSec % 3600) / 60)
  const s = diffSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
})
</script>

<template>
  <!-- Login — full page, no shell -->
  <router-view v-if="route.path === '/login'" />

  <v-app v-else :theme="isDark ? 'giteaDark' : 'giteaLight'" class="app-root">

    <!-- ═══════════════════════════════════════════════════
         SIDEBAR
    ════════════════════════════════════════════════════ -->
    <v-navigation-drawer
      v-model="drawer"
      :rail="rail"
      :permanent="!isMobile"
      :temporary="isMobile"
      width="232"
      rail-width="60"
      class="app-sidebar"
    >
      <!-- Decorative orbs -->
      <div class="sb-mesh" aria-hidden="true">
        <div class="sb-orb sb-orb--1" /><div class="sb-orb sb-orb--2" />
      </div>

      <!-- ── Brand row (logo + name + collapse btn) ── -->
      <div class="sb-brand" :class="{ 'sb-brand--rail': rail }">
        <div class="sb-logo">
          <v-icon size="16" color="primary">mdi-clock-fast</v-icon>
          <span class="sb-logo-ring" />
        </div>
        <transition name="sb-fade">
          <div v-if="!rail" class="sb-brand-text">
            <span class="sb-brand-name">Gitea Tracker</span>
            <span class="sb-brand-host">{{ serverHost }}</span>
          </div>
        </transition>
        <!-- Collapse toggle — top of sidebar, not bottom -->
        <button
          v-if="!isMobile"
          class="sb-collapse-btn"
          :title="rail ? 'Expand sidebar' : 'Collapse sidebar'"
          @click="rail = !rail"
        >
          <v-icon size="14">{{ rail ? 'mdi-chevron-right' : 'mdi-chevron-left' }}</v-icon>
        </button>
      </div>

      <div class="sb-divider" />

      <!-- ── Nav ── -->
      <nav class="sb-nav" role="navigation" aria-label="Main navigation">
        <router-link
          v-for="(item, i) in navItems"
          :key="item.to"
          :to="item.to"
          class="sb-item"
          :class="{ 'sb-item--active': route.path === item.to, 'sb-item--visible': navMounted }"
          :style="{ '--i': i }"
          :title="rail ? item.title : undefined"
          @click="isMobile && (drawer = false)"
        >
          <span class="sb-item__bar" />
          <span v-if="route.path === item.to" class="sb-item__glow" />
          <span class="sb-item__icon">
            <v-icon size="17">{{ route.path === item.to ? item.iconActive : item.icon }}</v-icon>
          </span>
          <transition name="sb-fade">
            <span v-if="!rail" class="sb-item__label">{{ item.title }}</span>
          </transition>
          <span v-if="route.path === item.to" class="sb-item__ripple" />
        </router-link>
      </nav>

      <div style="flex: 1" />

      <!-- ── User ── -->
      <div class="sb-divider" />
      <div class="sb-user" :class="{ 'sb-user--rail': rail }">
        <div class="sb-avatar">
          <v-img v-if="auth.profile?.avatar_url" :src="auth.profile.avatar_url" cover />
          <span v-else class="sb-avatar__init">{{ initials }}</span>
          <span class="sb-avatar-online" />
        </div>
        <transition name="sb-fade">
          <div v-if="!rail" class="sb-user-info">
            <span class="sb-user-name">{{ displayName }}</span>
            <span class="sb-user-sub">Online</span>
          </div>
        </transition>
      </div>

    </v-navigation-drawer>

    <!-- ═══════════════════════════════════════════════════
         TOP BAR
    ════════════════════════════════════════════════════ -->
    <v-app-bar :elevation="0" height="54" class="app-topbar" flat>

      <!-- Mobile hamburger -->
      <v-app-bar-nav-icon
        v-if="isMobile"
        size="small"
        class="topbar-hamburger"
        @click="drawer = !drawer"
      />

      <!-- Page icon + title -->
      <div class="topbar-left">
        <div class="topbar-page-icon">
          <transition name="title-swap" mode="out-in">
            <v-icon :key="route.path" size="15" color="primary">
              {{
                route.path === '/dashboard'     ? 'mdi-view-dashboard' :
                route.path === '/work-details'  ? 'mdi-calendar-clock' :
                route.path === '/sheets-export' ? 'mdi-google-spreadsheet' :
                'mdi-circle-small'
              }}
            </v-icon>
          </transition>
        </div>
        <transition name="title-swap" mode="out-in">
          <span :key="pageTitle" class="topbar-title">{{ pageTitle }}</span>
        </transition>
      </div>

      <v-spacer />

      <div class="topbar-right">

        <!-- ── Running stopwatch chip ── -->
        <transition name="tb-pop">
          <div
            v-if="runningStopwatch"
            class="topbar-stopwatch"
            :title="`#${runningStopwatch.issue_index}: ${runningStopwatch.issue_title}`"
          >
            <span class="topbar-sw-dot" />
            <span class="topbar-sw-num">#{{ runningStopwatch.issue_index }}</span>
            <span class="topbar-sw-title">{{ runningStopwatch.issue_title }}</span>
            <span class="topbar-sw-time">{{ stopwatchElapsed }}</span>
          </div>
        </transition>

        <div v-if="runningStopwatch" class="topbar-divider" />

        <!-- Clock -->
        <div class="topbar-clock">
          <v-icon size="12" class="topbar-clock__ico">mdi-clock-outline</v-icon>
          <span class="topbar-clock__time">{{ clockStr }}</span>
        </div>

        <div class="topbar-divider" />

        <!-- Refresh -->
        <button
          class="topbar-btn"
          :class="{ 'topbar-btn--spinning': refreshing }"
          title="Refresh data"
          @click="topbarRefresh"
        >
          <v-icon size="16">mdi-refresh</v-icon>
        </button>

        <!-- Theme -->
        <button
          class="topbar-btn"
          :title="isDark ? 'Light mode' : 'Dark mode'"
          @click="toggleTheme"
        >
          <transition name="theme-flip" mode="out-in">
            <v-icon :key="isDark ? 'd' : 'l'" size="16">
              {{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}
            </v-icon>
          </transition>
        </button>

        <div class="topbar-divider" />

        <!-- Server status -->
        <div class="topbar-server" :title="`Connected · ${serverHost}`">
          <span class="topbar-server__dot" />
          <span v-if="!isMobile" class="topbar-server__host">{{ serverHost }}</span>
        </div>

        <div class="topbar-divider" />

        <!-- User menu — use v-menu so it portals above the app bar -->
        <v-menu
          v-model="userMenuOpen"
          location="bottom end"
          :close-on-content-click="false"
          transition="scale-transition"
          offset="6"
        >
          <template #activator="{ props: menuProps }">
            <button class="topbar-user-btn" v-bind="menuProps" :title="displayName">
              <div class="topbar-avatar">
                <v-img v-if="auth.profile?.avatar_url" :src="auth.profile.avatar_url" cover />
                <span v-else class="topbar-avatar__init">{{ initials }}</span>
              </div>
              <span v-if="!isMobile" class="topbar-user-name">{{ displayName }}</span>
              <v-icon size="13" class="topbar-user-caret" :style="{ transform: userMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }">mdi-chevron-down</v-icon>
            </button>
          </template>

          <div class="topbar-menu">
            <div class="topbar-menu__header">
              <span class="topbar-menu__name">{{ displayName }}</span>
              <span class="topbar-menu__server">{{ serverHost }}</span>
            </div>
            <div class="topbar-menu__divider" />
            <button class="topbar-menu__item" @click="settingsOpen = true; userMenuOpen = false">
              <v-icon size="15">mdi-tune-vertical</v-icon>
              Settings
            </button>
            <button class="topbar-menu__item topbar-menu__item--danger" @click="logout">
              <v-icon size="15">mdi-logout</v-icon>
              Sign out
            </button>
          </div>
        </v-menu>

      </div>
    </v-app-bar>

    <!-- ═══════════════════════════════════════════════════
         SETTINGS DIALOG
    ════════════════════════════════════════════════════ -->
    <v-dialog v-model="settingsOpen" max-width="420">
      <transition name="pop">
        <div v-if="settingsOpen" class="settings-card">
          <div class="settings-hdr">
            <div class="settings-hdr__icon">
              <v-icon size="15" color="primary">mdi-tune-vertical</v-icon>
            </div>
            <div>
              <h3 class="settings-hdr__title">Settings</h3>
              <p class="settings-hdr__sub">Adjust targets and history range</p>
            </div>
            <button class="settings-close" @click="settingsOpen = false">
              <v-icon size="15">mdi-close</v-icon>
            </button>
          </div>
          <div class="settings-body">
            <div class="settings-field">
              <label class="settings-label">Target hours / day</label>
              <input v-model.number="timeStore.targetHoursPerDay" type="number" min="1" max="24" class="settings-input" />
            </div>
            <div class="settings-field">
              <label class="settings-label">Work days / week</label>
              <input v-model.number="timeStore.workDaysPerWeek" type="number" min="1" max="7" class="settings-input" />
            </div>
            <div class="settings-field">
              <label class="settings-label">History range (days)</label>
              <input v-model.number="timeStore.rangeDays" type="number" min="7" max="365" class="settings-input" />
            </div>
          </div>
          <div class="settings-foot">
            <button class="settings-btn settings-btn--ghost" @click="settingsOpen = false">Cancel</button>
            <button class="settings-btn settings-btn--primary" @click="saveSettings">Save &amp; refresh</button>
          </div>
        </div>
      </transition>
    </v-dialog>

    <!-- ═══════════════════════════════════════════════════
         MAIN CONTENT
    ════════════════════════════════════════════════════ -->
    <v-main class="app-main">
      <div class="app-content">
        <router-view v-slot="{ Component, route: r }">
          <transition name="page" mode="out-in">
            <component :is="Component" :key="r.path" />
          </transition>
        </router-view>
      </div>
    </v-main>

  </v-app>
</template>

<style scoped>
/* ── Root ─────────────────────────────────────────────────── */
.app-root { background: var(--bg-base) !important; min-height: 100vh; transition: background-color .4s ease; }

/* ══════════════════════════════════════════════════════════
   SIDEBAR
   ══════════════════════════════════════════════════════════ */
:deep(.app-sidebar) {
  background: var(--bg-surface) !important;
  border-right: 1px solid var(--border) !important;
  transition: background-color .4s ease, border-color .4s ease !important;
  overflow: hidden; position: relative;
}
:deep(.app-sidebar .v-navigation-drawer__content) {
  display: flex; flex-direction: column; height: 100%;
  overflow-x: hidden; overflow-y: auto; position: relative; z-index: 1;
}

/* Decorative orbs */
.sb-mesh { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 0; }
.sb-orb  { position: absolute; border-radius: 50%; filter: blur(48px); pointer-events: none; }
.sb-orb--1 {
  width: 180px; height: 180px; top: -40px; left: -50px;
  background: radial-gradient(circle, var(--orb-1-color), transparent 70%);
  opacity: .07; animation: float-wide 14s ease-in-out infinite;
}
.sb-orb--2 {
  width: 130px; height: 130px; bottom: 60px; right: -30px;
  background: radial-gradient(circle, var(--orb-2-color), transparent 70%);
  opacity: .05; animation: float-wide 18s ease-in-out infinite reverse;
}

/* Brand row */
.sb-brand {
  display: flex; align-items: center; gap: 9px;
  padding: 14px 12px 10px; min-height: 56px; flex-shrink: 0;
  position: relative; z-index: 1;
}
.sb-brand--rail { justify-content: center; padding: 14px 0 10px; }

.sb-logo {
  width: 32px; height: 32px; flex-shrink: 0;
  background: var(--color-primary-dim);
  border: 1px solid rgba(var(--color-primary-rgb),.25); border-radius: 9px;
  display: flex; align-items: center; justify-content: center; position: relative;
  transition: transform 260ms var(--ease-spring), box-shadow 260ms;
}
.sb-logo:hover { transform: scale(1.1) rotate(-6deg); box-shadow: 0 0 14px rgba(var(--color-primary-rgb),.35); }
.sb-logo-ring {
  position: absolute; inset: -4px; border-radius: 13px;
  border: 1.5px solid rgba(var(--color-primary-rgb),.2);
  animation: ripple-out 2.8s ease-out infinite; pointer-events: none;
}
.sb-brand-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.sb-brand-name { font-size: 13px; font-weight: 700; color: var(--text-primary); white-space: nowrap; letter-spacing: -.01em; }
.sb-brand-host { font-size: 10px; color: var(--text-muted); font-family: 'JetBrains Mono',monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }

/* Collapse button — in brand row */
.sb-collapse-btn {
  width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0;
  border: 1px solid var(--border); background: transparent; color: var(--text-muted);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background 130ms, color 130ms, border-color 130ms, transform 200ms var(--ease-spring);
}
.sb-collapse-btn:hover {
  background: var(--color-primary-dim); color: var(--color-primary);
  border-color: rgba(var(--color-primary-rgb),.3); transform: scale(1.1);
}

/* Divider */
.sb-divider { height: 1px; background: var(--border); margin: 0 10px; flex-shrink: 0; }

/* Nav */
.sb-nav { display: flex; flex-direction: column; gap: 1px; padding: 7px 6px; flex-shrink: 0; position: relative; z-index: 1; }
.sb-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 9px; border-radius: 10px;
  text-decoration: none; color: var(--text-secondary); font-size: 13px; font-weight: 500;
  position: relative; overflow: hidden; white-space: nowrap;
  opacity: 0; transform: translateX(-10px);
  transition: background 130ms, color 130ms, opacity 320ms var(--ease-out), transform 320ms var(--ease-out);
}
.sb-item--visible { opacity: 1; transform: translateX(0); transition-delay: calc(var(--i) * 50ms); }
.sb-item:hover { background: var(--sb-hover-bg); color: var(--text-primary); }
.sb-item--active { color: var(--color-primary); }
.sb-item--active:hover { background: var(--sb-active-hover); }
.sb-item__bar {
  position: absolute; left: 0; top: 50%; transform: translateY(-50%) scaleY(0);
  width: 3px; height: 18px; background: var(--color-primary); border-radius: 0 3px 3px 0;
  transition: transform 240ms var(--ease-spring);
}
.sb-item--active .sb-item__bar { transform: translateY(-50%) scaleY(1); }
.sb-item__glow { position: absolute; inset: 0; background: var(--sb-active-bg); border-radius: inherit; pointer-events: none; animation: slide-up 200ms var(--ease-out) both; }
.sb-item__ripple { position: absolute; inset: 0; border-radius: inherit; border: 1px solid rgba(var(--color-primary-rgb),.18); pointer-events: none; animation: ripple-out 2.2s ease-out infinite; }
.sb-item__icon { display: flex; align-items: center; justify-content: center; width: 20px; flex-shrink: 0; transition: transform 220ms var(--ease-spring); }
.sb-item:hover .sb-item__icon { transform: scale(1.15) rotate(-3deg); }
.sb-item--active .sb-item__icon { transform: scale(1.07); }
.sb-item__label { flex: 1; overflow: hidden; text-overflow: ellipsis; }

/* ── Running task widget ── */
.sb-task {
  margin: 6px 8px 2px; padding: 9px 11px 8px;
  background: rgba(79,142,247,.07); border: 1px solid rgba(79,142,247,.18);
  border-radius: var(--radius-lg); display: flex; flex-direction: column; gap: 5px;
  flex-shrink: 0; position: relative; z-index: 1; overflow: hidden;
  animation: sb-in 260ms var(--ease-out) both;
}
@keyframes sb-in { from { opacity:0; transform:translateY(-3px); } to { opacity:1; transform:translateY(0); } }
.sb-task::before {
  content:''; position:absolute; top:0; left:0; right:0; height:2px;
  background: linear-gradient(90deg, var(--color-primary), var(--color-violet));
}
.sb-task__row1 { display: flex; align-items: center; gap: 6px; }
.sb-task__lbl { font-size: 9px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: .09em; flex: 1; }
.sb-task__timer {
  font-family: 'JetBrains Mono',monospace; font-size: 11.5px; font-weight: 800;
  color: var(--color-primary); font-variant-numeric: tabular-nums;
  background: var(--color-primary-dim); padding: 1px 6px; border-radius: 5px;
}
.sb-task__dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--color-success); flex-shrink: 0;
  animation: sw-pulse 1.8s ease-out infinite;
}
@keyframes sw-pulse {
  0%   { box-shadow: 0 0 0 0   rgba(var(--color-success-rgb),.65); }
  60%  { box-shadow: 0 0 0 6px rgba(var(--color-success-rgb),0); }
  100% { box-shadow: 0 0 0 0   rgba(var(--color-success-rgb),0); }
}
.sb-task__row2 { display: flex; align-items: baseline; gap: 5px; min-width: 0; }
.sb-task__num { font-family: 'JetBrains Mono',monospace; font-size: 10.5px; font-weight: 800; color: var(--color-primary); flex-shrink: 0; }
.sb-task__title { font-size: 11.5px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-task__bar { height: 2px; border-radius: 99px; background: rgba(79,142,247,.1); overflow: hidden; }
.sb-task__bar-fill {
  height: 100%; width: 42%; border-radius: 99px;
  background: linear-gradient(90deg, var(--color-primary), var(--color-violet));
  animation: sw-bar 2.2s linear infinite;
}
@keyframes sw-bar { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }

/* Rail task */
.sb-task-rail { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 7px 0 3px; flex-shrink: 0; position: relative; z-index: 1; cursor: default; }
.sb-task-rail__time { font-family: 'JetBrains Mono',monospace; font-size: 8px; font-weight: 700; color: var(--color-primary); font-variant-numeric: tabular-nums; line-height: 1; }

/* User section */
.sb-user { display: flex; align-items: center; gap: 9px; padding: 10px 11px 12px; flex-shrink: 0; position: relative; z-index: 1; }
.sb-user--rail { justify-content: center; padding: 10px 0 12px; }
.sb-avatar {
  width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
  background: var(--bg-surface-2); border: 2px solid var(--border-strong);
  overflow: hidden; display: flex; align-items: center; justify-content: center; position: relative;
  transition: transform 220ms var(--ease-spring), box-shadow 220ms;
}
.sb-avatar:hover { transform: scale(1.1); box-shadow: 0 0 10px rgba(var(--color-primary-rgb),.3); }
.sb-avatar__init { font-size: 11px; font-weight: 700; color: var(--color-primary); }
.sb-avatar-online { position: absolute; bottom: 0; right: 0; width: 8px; height: 8px; background: var(--color-success); border-radius: 50%; border: 2px solid var(--bg-surface); animation: pulse-scale 2.5s ease-in-out infinite; }
.sb-user-info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.sb-user-name { font-size: 12px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sb-user-sub { font-size: 10px; color: var(--text-muted); }

/* ══════════════════════════════════════════════════════════
   TOP BAR
   ══════════════════════════════════════════════════════════ */
:deep(.app-topbar) {
  background: var(--topbar-bg) !important;
  backdrop-filter: blur(20px) saturate(1.3) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.3) !important;
  border-bottom: 1px solid var(--border) !important;
  transition: background-color .4s ease !important;
}
:deep(.app-topbar .v-toolbar__content) { padding: 0 14px 0 10px !important; gap: 0; }

.topbar-hamburger { color: var(--text-secondary) !important; margin-right: 4px; }

.topbar-left { display: flex; align-items: center; gap: 7px; margin-left: 2px; }
.topbar-page-icon {
  width: 28px; height: 28px; border-radius: 7px;
  background: var(--color-primary-dim); border: 1px solid rgba(var(--color-primary-rgb),.18);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.topbar-title { font-size: 14.5px; font-weight: 600; color: var(--text-primary); letter-spacing: -.01em; }

.topbar-right { display: flex; align-items: center; gap: 3px; }

.topbar-divider { width: 1px; height: 20px; background: var(--border-strong); margin: 0 5px; border-radius: 1px; flex-shrink: 0; }

/* ── Stopwatch chip ── */
.topbar-stopwatch {
  display: flex; align-items: center; gap: 7px;
  padding: 4px 12px 4px 9px; border-radius: 8px;
  background: rgba(79,142,247,.1); border: 1px solid rgba(79,142,247,.22);
  cursor: default; user-select: none; max-width: 300px;
  transition: background 150ms;
}
.topbar-stopwatch:hover { background: rgba(79,142,247,.16); }
.topbar-sw-dot {
  width: 7px; height: 7px; border-radius: 50%; background: var(--color-success); flex-shrink: 0;
  animation: sw-pulse 1.8s ease-out infinite;
}
@keyframes sw-pulse {
  0%   { box-shadow: 0 0 0 0   rgba(var(--color-success-rgb),.65); }
  60%  { box-shadow: 0 0 0 5px rgba(var(--color-success-rgb),0); }
  100% { box-shadow: 0 0 0 0   rgba(var(--color-success-rgb),0); }
}
.topbar-sw-num { font-family: 'JetBrains Mono',monospace; font-size: 11.5px; font-weight: 800; color: var(--color-primary); flex-shrink: 0; }
.topbar-sw-title { font-size: 12px; font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; max-width: 160px; }
.topbar-sw-time { font-family: 'JetBrains Mono',monospace; font-size: 12px; font-weight: 800; color: var(--color-primary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
@media (max-width: 800px) { .topbar-sw-title { display: none; } .topbar-stopwatch { max-width: unset; } }

/* Clock */
.topbar-clock {
  display: flex; align-items: center; gap: 5px; padding: 3px 9px;
  border-radius: 7px; background: var(--bg-surface-2); border: 1px solid var(--border);
  cursor: default; user-select: none;
}
.topbar-clock__ico { color: var(--text-muted) !important; flex-shrink: 0; }
.topbar-clock__time { font-size: 11.5px; font-weight: 600; color: var(--text-secondary); font-family: 'JetBrains Mono',monospace; letter-spacing: .04em; min-width: 65px; }
@media (max-width: 600px) { .topbar-clock { display: none; } }

/* Icon buttons */
.topbar-btn {
  width: 32px; height: 32px; border-radius: 8px; border: 1px solid transparent;
  background: transparent; color: var(--text-secondary); cursor: pointer;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: background 130ms, color 130ms, border-color 130ms, transform 200ms var(--ease-spring);
}
.topbar-btn:hover { background: var(--bg-surface-2); color: var(--text-primary); border-color: var(--border-strong); transform: scale(1.07); }
.topbar-btn:active { transform: scale(0.94); }
.topbar-btn--spinning .v-icon { animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Server badge */
.topbar-server {
  display: flex; align-items: center; gap: 5px; padding: 3px 10px 3px 7px;
  border-radius: 20px; border: 1px solid var(--border); background: var(--bg-surface-2);
  cursor: default; user-select: none;
  transition: background 140ms, border-color 140ms;
}
.topbar-server:hover { background: var(--bg-surface-3); border-color: rgba(var(--color-success-rgb),.3); }
.topbar-server__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-success); flex-shrink: 0; animation: pulse-scale 2.2s ease-in-out infinite; box-shadow: 0 0 5px rgba(var(--color-success-rgb),.5); }
.topbar-server__host { font-size: 11px; font-weight: 600; color: var(--text-secondary); font-family: 'JetBrains Mono',monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }

/* User menu button */
/* User menu button */
.topbar-user-btn {
  display: flex; align-items: center; gap: 7px; height: 34px; padding: 0 8px;
  border-radius: 9px; border: 1px solid transparent; background: transparent;
  color: var(--text-primary); cursor: pointer;
  transition: background 130ms, border-color 130ms;
}
.topbar-user-btn:hover { background: var(--bg-surface-2); border-color: var(--border-strong); }
.topbar-avatar {
  width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
  background: var(--bg-surface-2); border: 1.5px solid var(--border-strong);
  overflow: hidden; display: flex; align-items: center; justify-content: center;
}
.topbar-avatar__init { font-size: 10px; font-weight: 700; color: var(--color-primary); }
.topbar-user-name { font-size: 12.5px; font-weight: 600; white-space: nowrap; max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.topbar-user-caret { color: var(--text-muted) !important; }

/* Dropdown menu — rendered inside v-menu overlay (no positional CSS needed, Vuetify handles it) */
.topbar-menu {
  min-width: 210px;
  background: var(--bg-surface-2); border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl); box-shadow: var(--shadow-xl);
  overflow: hidden;
}
.topbar-menu__header { padding: 13px 15px 10px; }
.topbar-menu__name { display: block; font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 2px; }
.topbar-menu__server { display: block; font-size: 10.5px; color: var(--text-muted); font-family: 'JetBrains Mono',monospace; }
.topbar-menu__divider { height: 1px; background: var(--border); margin: 0 10px; }
.topbar-menu__item {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 11px 15px; border: none; background: none;
  font-size: 13px; font-weight: 500; font-family: inherit; color: var(--text-secondary);
  cursor: pointer; text-align: left;
  transition: background 100ms, color 100ms;
}
.topbar-menu__item:hover { background: var(--bg-surface-3); color: var(--text-primary); }
.topbar-menu__item--danger:hover { background: rgba(var(--color-error-rgb),.1); color: var(--color-error); }

/* Vuetify v-menu overlay inherits theme — override card background */
:deep(.v-overlay__content .topbar-menu) {
  background: var(--bg-surface-2) !important;
  border: 1px solid var(--border-strong) !important;
}

/* ══════════════════════════════════════════════════════════
   SETTINGS DIALOG
   ══════════════════════════════════════════════════════════ */
.settings-card {
  background: var(--bg-surface-2); border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl); padding: 20px 22px 18px;
  display: flex; flex-direction: column; gap: 16px; box-shadow: var(--shadow-xl);
}
.settings-hdr { display: flex; align-items: flex-start; gap: 11px; }
.settings-hdr__icon {
  width: 32px; height: 32px; flex-shrink: 0; border-radius: 9px;
  background: var(--color-primary-dim); border: 1px solid rgba(79,142,247,.2);
  display: flex; align-items: center; justify-content: center;
}
.settings-hdr__title { font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0 0 2px; letter-spacing: -.01em; }
.settings-hdr__sub { font-size: 11.5px; color: var(--text-muted); margin: 0; }
.settings-close {
  margin-left: auto; width: 26px; height: 26px; flex-shrink: 0;
  border: 1px solid var(--border); background: none; border-radius: 7px;
  color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background 120ms, color 120ms;
}
.settings-close:hover { background: var(--bg-surface-3); color: var(--text-primary); }
.settings-body { display: flex; flex-direction: column; gap: 12px; }
.settings-field { display: flex; flex-direction: column; gap: 5px; }
.settings-label { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; }
.settings-input {
  height: 38px; padding: 0 12px;
  background: var(--bg-surface-1); border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg); color: var(--text-primary);
  font-size: 13.5px; font-family: inherit; outline: none;
  transition: border-color 200ms, box-shadow 200ms;
}
.settings-input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(79,142,247,.12); }
.settings-foot { display: flex; justify-content: flex-end; gap: 8px; }
.settings-btn {
  height: 34px; padding: 0 16px; border-radius: var(--radius-lg);
  font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: background 120ms, transform 120ms;
}
.settings-btn:active { transform: scale(0.97); }
.settings-btn--ghost { background: var(--bg-surface-1); border: 1px solid var(--border-strong); color: var(--text-secondary); }
.settings-btn--ghost:hover { background: var(--bg-surface-3); color: var(--text-primary); }
.settings-btn--primary { background: var(--color-primary-dim); border: 1px solid rgba(79,142,247,.25); color: var(--color-primary); }
.settings-btn--primary:hover { background: rgba(79,142,247,.22); }

/* ══════════════════════════════════════════════════════════
   MAIN CONTENT
   ══════════════════════════════════════════════════════════ */
:deep(.app-main) { background: var(--bg-base) !important; transition: background-color .4s ease !important; }
:deep(.app-main .v-main__wrap) { display: flex; flex-direction: column; }
.app-content { padding: 20px 24px 28px; min-height: 100%; flex: 1; width: 100%; }

/* ══════════════════════════════════════════════════════════
   TRANSITIONS
   ══════════════════════════════════════════════════════════ */
.page-enter-active { transition: opacity 240ms var(--ease-out), transform 240ms var(--ease-out); }
.page-leave-active { transition: opacity 160ms var(--ease-in), transform 160ms var(--ease-in); }
.page-enter-from { opacity: 0; transform: translateY(8px) scale(.99); }
.page-leave-to   { opacity: 0; transform: translateY(-5px) scale(1.01); }

.sb-fade-enter-active, .sb-fade-leave-active { transition: opacity 160ms var(--ease); }
.sb-fade-enter-from, .sb-fade-leave-to { opacity: 0; }

.title-swap-enter-active { transition: all 200ms var(--ease-spring); }
.title-swap-leave-active { transition: all 120ms var(--ease-in); }
.title-swap-enter-from { opacity: 0; transform: translateY(5px); }
.title-swap-leave-to   { opacity: 0; transform: translateY(-4px); }

.theme-flip-enter-active { transition: all 260ms var(--ease-spring); }
.theme-flip-leave-active { transition: all 140ms var(--ease-in); }
.theme-flip-enter-from { opacity: 0; transform: rotate(-90deg) scale(.5); }
.theme-flip-leave-to   { opacity: 0; transform: rotate(90deg) scale(.5); }

.tb-pop-enter-active { transition: all 200ms var(--ease-spring); }
.tb-pop-leave-active { transition: all 140ms var(--ease-in); }
.tb-pop-enter-from, .tb-pop-leave-to { opacity: 0; transform: scale(.95) translateX(8px); }

.tb-drop-enter-active { transition: all 160ms var(--ease-out); }
.tb-drop-leave-active { transition: all 110ms var(--ease-in); }
.tb-drop-enter-from, .tb-drop-leave-to { opacity: 0; transform: translateY(-6px) scale(.97); }

.pop-enter-active { transition: all 260ms var(--ease-spring); }
.pop-leave-active { transition: all 160ms var(--ease-in); }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: scale(.88); }

/* ── Responsive ─────────────────────────────────────────── */
@media (max-width: 960px) { .app-content { padding: 14px 16px 24px; } }
@media (max-width: 600px) { .app-content { padding: 10px 12px 20px; } }
</style>
