<script setup lang="ts">
import { reactive, ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { useAuthStore, DEFAULT_BASE_URL } from '../stores/auth'
import { useTimeTrackingStore } from '../stores/timeTracking'
import { useParticles } from '../composables/useParticles'

const auth      = useAuthStore()
const timeStore = useTimeTrackingStore()
const router    = useRouter()
const theme     = useTheme()

// ── Theme ─────────────────────────────────────────────────
const isDark = computed(() => theme.global.name.value === 'giteaDark')
function toggleTheme() {
  theme.global.name.value = isDark.value ? 'giteaLight' : 'giteaDark'
  document.documentElement.setAttribute('data-theme', isDark.value ? 'dark' : 'light')
}

// ── Particles ─────────────────────────────────────────────
const canvasRef = ref<HTMLCanvasElement | null>(null)
const { mount: mountParticles, unmount: unmountParticles, start: startParticles } = useParticles(canvasRef, { count: 60 })

onMounted(() => {
  setTimeout(() => { mounted.value = true }, 50)
  mountParticles(isDark.value)
})
onUnmounted(() => unmountParticles())

// Watch AFTER startParticles is defined
watch(isDark, (dark) => {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  startParticles(dark)
})

// ── Form ───────────────────────────────────────────────────
const form = reactive({
  baseUrl:  auth.baseUrl || DEFAULT_BASE_URL,
  username: auth.username || '',
  secret:   '',
  authMode: 'basic' as 'basic' | 'token',
})
const remember     = ref(true)
const showPassword = ref(false)
const mounted      = ref(false)

async function submit() {
  if (!form.baseUrl || !form.username || !form.secret) {
    auth.authError = 'Please fill in server URL, username, and token/password.'
    return
  }
  const ok = await auth.login(
    { baseUrl: form.baseUrl, username: form.username, secret: form.secret, authMode: form.authMode },
    remember.value,
  )
  if (ok) {
    await timeStore.fetchAll()
    router.push('/dashboard')
  }
}
</script>

<template>
  <v-app :theme="isDark ? 'giteaDark' : 'giteaLight'" class="login-app">

    <!-- ── Live particle canvas ─────────────────────────────── -->
    <canvas ref="canvasRef" class="login-canvas" aria-hidden="true" />

    <!-- ── Ambient orbs ────────────────────────────────────── -->
    <div class="login-bg" aria-hidden="true">
      <div class="bg-orb bg-orb--1" />
      <div class="bg-orb bg-orb--2" />
      <div class="bg-orb bg-orb--3" />
      <div class="bg-orb bg-orb--4" />
      <div class="bg-blob bg-blob--1" />
      <div class="bg-blob bg-blob--2" />
      <div class="bg-grid" />
      <div class="bg-ring bg-ring--1" />
      <div class="bg-ring bg-ring--2" />
    </div>

    <!-- ── Theme toggle ─────────────────────────────────────── -->
    <button class="theme-fab" :title="isDark ? 'Switch to light' : 'Switch to dark'" @click="toggleTheme">
      <transition name="theme-flip" mode="out-in">
        <v-icon :key="isDark ? 'd' : 'l'" size="18" :color="isDark ? 'warning' : 'primary'">
          {{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}
        </v-icon>
      </transition>
    </button>

    <v-main class="login-main">
      <div class="login-center">

        <!-- ── Card ─────────────────────────────────────────── -->
        <transition name="login-in" appear>
          <div v-if="mounted" class="login-card card-glass">

            <!-- Card shimmer highlight -->
            <div class="card-shimmer" />

            <!-- ── Brand ─────────────────────────────────────── -->
            <div class="login-brand">
              <div class="login-brand__icon">
                <v-icon size="22" color="primary">mdi-clock-fast</v-icon>
                <span class="brand-ring brand-ring--1" />
                <span class="brand-ring brand-ring--2" />
              </div>
              <div class="login-brand__text">
                <span class="login-brand__name">Gitea Tracker</span>
                <span class="login-brand__tag">Time Intelligence</span>
              </div>
            </div>

            <div class="login-header">
              <h1 class="login-title">
                Welcome back
                <span class="title-cursor" />
              </h1>
              <p class="login-subtitle">
                Connect to your Gitea instance to start tracking.
              </p>
            </div>

            <!-- ── Form ──────────────────────────────────────── -->
            <form class="login-form" @submit.prevent="submit">

              <!-- Server URL -->
              <div class="field-group">
                <label class="field-label" for="server-url">Gitea server URL</label>
                <div class="field-input-wrap glow-border">
                  <span class="field-icon">
                    <v-icon size="16" color="secondary">mdi-server-network</v-icon>
                  </span>
                  <input
                    id="server-url"
                    v-model="form.baseUrl"
                    type="url"
                    class="field-input"
                    placeholder="http://your-gitea.example.com"
                    autocomplete="url"
                    spellcheck="false"
                  />
                </div>
              </div>

              <!-- Username -->
              <div class="field-group">
                <label class="field-label" for="username">Username</label>
                <div class="field-input-wrap glow-border">
                  <span class="field-icon">
                    <v-icon size="16" color="secondary">mdi-account-outline</v-icon>
                  </span>
                  <input
                    id="username"
                    v-model="form.username"
                    type="text"
                    class="field-input"
                    placeholder="yourname"
                    autocomplete="username"
                    spellcheck="false"
                  />
                </div>
              </div>

              <!-- Password / Token -->
              <div class="field-group">
                <div class="field-label-row">
                  <label class="field-label" for="secret">
                    {{ form.authMode === 'token' ? 'Access token' : 'Password' }}
                  </label>
                  <button
                    type="button"
                    class="mode-toggle"
                    @click="form.authMode = form.authMode === 'basic' ? 'token' : 'basic'"
                  >
                    <v-icon size="12">mdi-swap-horizontal</v-icon>
                    {{ form.authMode === 'basic' ? 'Use token instead' : 'Use password instead' }}
                  </button>
                </div>
                <div class="field-input-wrap glow-border">
                  <span class="field-icon">
                    <v-icon size="16" color="secondary">
                      {{ form.authMode === 'token' ? 'mdi-key-outline' : 'mdi-lock-outline' }}
                    </v-icon>
                  </span>
                  <input
                    id="secret"
                    v-model="form.secret"
                    :type="showPassword ? 'text' : 'password'"
                    class="field-input"
                    :placeholder="form.authMode === 'token' ? 'glpat-xxxxxxxxxxxx' : '••••••••'"
                    autocomplete="current-password"
                  />
                  <button
                    type="button"
                    class="field-eye"
                    :aria-label="showPassword ? 'Hide' : 'Show'"
                    @click="showPassword = !showPassword"
                  >
                    <v-icon size="16">{{ showPassword ? 'mdi-eye-off-outline' : 'mdi-eye-outline' }}</v-icon>
                  </button>
                </div>
              </div>

              <!-- Remember me -->
              <label class="remember-row">
                <span class="custom-check" :class="{ 'custom-check--on': remember }">
                  <input v-model="remember" type="checkbox" hidden />
                  <transition name="check-pop">
                    <v-icon v-if="remember" size="11" color="white">mdi-check</v-icon>
                  </transition>
                </span>
                <span class="remember-label">Remember me on this device</span>
              </label>

              <!-- Error -->
              <transition name="fade">
                <div v-if="auth.authError" class="login-error" role="alert">
                  <v-icon size="15" color="error">mdi-alert-circle-outline</v-icon>
                  <span>{{ auth.authError }}</span>
                </div>
              </transition>

              <!-- Submit -->
              <button
                type="submit"
                class="login-btn"
                :class="{ 'login-btn--loading': auth.isAuthenticating }"
                :disabled="auth.isAuthenticating"
              >
                <span class="btn-shine" />
                <span v-if="!auth.isAuthenticating" class="login-btn__content">
                  <v-icon size="16">mdi-lightning-bolt</v-icon>
                  Connect to Gitea
                </span>
                <span v-else class="login-btn__content">
                  <span class="orbit-loader">
                    <span class="orbit-dot" />
                  </span>
                  Connecting…
                </span>
              </button>
            </form>

            <!-- Footer note -->
            <div class="login-note">
              <v-icon size="13" color="secondary" class="mr-1">mdi-shield-check-outline</v-icon>
              Reads only <em>your</em> tracked time via
              <code>GET /user/times</code>.
              Token scopes: <code>read:user</code>, <code>read:issue</code>.
            </div>

          </div>
        </transition>

      </div>
    </v-main>
  </v-app>
</template>

<style scoped>
/* ── App / layout ─────────────────────────────────────────── */
.login-app {
  background: var(--bg-base) !important;
  position: relative;
  overflow-x: hidden;   
  min-height: 100vh;
  transition: background-color 0.5s ease;
}
.login-main  { position: relative; z-index: 2; }
:deep(.login-main .v-main__wrap) { overflow-y: auto; }
.login-center {
  min-height: 94vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;   
}

/* ── Canvas particles ─────────────────────────────────────── */
.login-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

/* ── Ambient background ───────────────────────────────────── */
.login-bg {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: var(--orb-opacity);
}
.bg-orb--1 {
  width: 620px; height: 620px;
  top: -160px; left: -120px;
  background: radial-gradient(circle, var(--orb-1-color), transparent 65%);
  animation: float-wide 16s ease-in-out infinite;
}
.bg-orb--2 {
  width: 520px; height: 520px;
  bottom: -120px; right: -100px;
  background: radial-gradient(circle, var(--orb-2-color), transparent 65%);
  animation: float-wide 20s ease-in-out infinite reverse;
  animation-delay: -5s;
}
.bg-orb--3 {
  width: 360px; height: 360px;
  top: 35%; left: 50%;
  background: radial-gradient(circle, var(--orb-3-color), transparent 65%);
  opacity: calc(var(--orb-opacity) * 0.55);
  animation: float 12s ease-in-out infinite;
  animation-delay: -8s;
}
.bg-orb--4 {
  width: 260px; height: 260px;
  top: 10%; right: 15%;
  background: radial-gradient(circle, #2dd4bf, transparent 65%);
  opacity: calc(var(--orb-opacity) * 0.45);
  animation: float 9s ease-in-out infinite;
  animation-delay: -3s;
}

.bg-blob {
  position: absolute;
  filter: blur(70px);
  opacity: calc(var(--orb-opacity) * 0.7);
}
.bg-blob--1 {
  width: 300px; height: 300px;
  top: 20%; left: 5%;
  background: linear-gradient(135deg, var(--orb-1-color), var(--orb-2-color));
  animation: morph 14s ease-in-out infinite, float 10s ease-in-out infinite;
}
.bg-blob--2 {
  width: 220px; height: 220px;
  bottom: 15%; right: 8%;
  background: linear-gradient(135deg, var(--orb-3-color), var(--orb-2-color));
  animation: morph 18s ease-in-out infinite reverse, float 13s ease-in-out infinite reverse;
}

.bg-grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(var(--grid-line) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: radial-gradient(ellipse 85% 85% at 50% 50%, black, transparent);
}

.bg-ring {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}
.bg-ring--1 {
  width: 700px; height: 700px;
  top: 50%; left: 50%;
  margin: -350px 0 0 -350px;
  border: 1px solid rgba(var(--color-primary-rgb), 0.07);
  animation: spin-rev 40s linear infinite;
}
.bg-ring--2 {
  width: 480px; height: 480px;
  top: 50%; left: 50%;
  margin: -240px 0 0 -240px;
  border: 1px solid rgba(167, 139, 250, 0.06);
  animation: spin 28s linear infinite;
}

/* ── Theme FAB ────────────────────────────────────────────── */
.theme-fab {
  position: fixed;
  top: 18px; right: 18px;
  z-index: 10;
  width: 40px; height: 40px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-strong);
  background: var(--glass-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: var(--shadow-md);
  transition:
    transform   220ms var(--ease-spring),
    box-shadow  220ms var(--ease),
    border-color 220ms var(--ease);
}
.theme-fab:hover {
  transform: scale(1.12) rotate(12deg);
  box-shadow: var(--shadow-glow-primary);
  border-color: var(--color-primary);
}

/* ── Login card ───────────────────────────────────────────── */
.login-card {
  width: 100%;
  max-width: 424px;
  position: relative;
  padding: 36px 36px 28px;
  overflow: hidden;
}

.card-shimmer {
  position: absolute;
  top: -60%; left: -60%;
  width: 60%; height: 200%;
  background: linear-gradient(
    105deg,
    transparent 40%,
    rgba(255,255,255,0.06) 50%,
    transparent 60%
  );
  transform: skewX(-15deg);
  animation: card-shimmer-sweep 4s ease-in-out infinite;
  pointer-events: none;
  z-index: 0;
}
@keyframes card-shimmer-sweep {
  0%   { left: -60%; opacity: 0; }
  10%  { opacity: 1; }
  50%  { left: 120%; opacity: 1; }
  60%  { opacity: 0; }
  100% { left: 120%; opacity: 0; }
}

/* ── Brand ────────────────────────────────────────────────── */
.login-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
  position: relative; z-index: 1;
}
.login-brand__icon {
  width: 44px; height: 44px;
  background: var(--color-primary-dim);
  border: 1px solid rgba(var(--color-primary-rgb), 0.28);
  border-radius: var(--radius-xl);
  display: flex; align-items: center; justify-content: center;
  position: relative; flex-shrink: 0;
  animation: float 5s ease-in-out infinite;
}
.brand-ring {
  position: absolute;
  inset: -6px;
  border-radius: 24px;
  pointer-events: none;
}
.brand-ring--1 { border: 1.5px solid rgba(var(--color-primary-rgb), 0.18); animation: ripple-out 2.2s ease-out infinite; }
.brand-ring--2 { border: 1.5px solid rgba(var(--color-primary-rgb), 0.10); animation: ripple-out 2.2s ease-out infinite 1.1s; }

.login-brand__text { display: flex; flex-direction: column; }
.login-brand__name {
  font-size: 16px; font-weight: 700;
  color: var(--text-primary); letter-spacing: -0.01em;
}
.login-brand__tag {
  font-size: 10.5px; color: var(--color-primary); font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.85;
}

/* ── Header ───────────────────────────────────────────────── */
.login-header { margin-bottom: 24px; position: relative; z-index: 1; }
.login-title {
  font-size: 24px; font-weight: 700; color: var(--text-primary);
  letter-spacing: -0.025em; line-height: 1.2; margin: 0 0 6px;
  display: flex; align-items: center; gap: 2px;
}
.title-cursor {
  display: inline-block; width: 2px; height: 26px;
  background: var(--color-primary); border-radius: 2px; margin-left: 4px;
  animation: blink 1s step-end infinite; vertical-align: middle;
}
.login-subtitle { font-size: 13.5px; color: var(--text-secondary); margin: 0; line-height: 1.55; }

/* ── Form ─────────────────────────────────────────────────── */
.login-form { display: flex; flex-direction: column; gap: 16px; position: relative; z-index: 1; }
.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); letter-spacing: 0.03em; }
.field-label-row { display: flex; align-items: center; justify-content: space-between; }
.mode-toggle {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 500; color: var(--color-primary);
  background: none; border: none; cursor: pointer; padding: 0; opacity: 0.8;
  transition: opacity var(--dur-fast) var(--ease);
}
.mode-toggle:hover { opacity: 1; }

.field-input-wrap {
  position: relative; display: flex; align-items: center;
  border-radius: var(--radius-lg); border: 1px solid var(--border-strong);
  transition: border-color var(--dur-normal) var(--ease), box-shadow var(--dur-normal) var(--ease);
}
.field-icon {
  position: absolute; left: 12px;
  display: flex; align-items: center; pointer-events: none; z-index: 1;
}
.field-eye {
  position: absolute; right: 10px; width: 28px; height: 28px;
  border: none; background: none; cursor: pointer; color: var(--text-muted);
  border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease), transform 200ms var(--ease-spring);
}
.field-eye:hover {
  color: var(--text-secondary);
  background: rgba(var(--color-primary-rgb), 0.08);
  transform: scale(1.1);
}
.field-input {
  width: 100%; height: 44px; padding: 0 12px 0 38px;
  background: var(--bg-surface-2); border: none; border-radius: var(--radius-lg);
  color: var(--text-primary); font-size: 14px; font-family: inherit; outline: none;
  transition: background var(--dur-normal) var(--ease);
}
.field-input::placeholder { color: var(--text-muted); }
.field-input:focus { background: var(--bg-surface-3); }

/* ── Remember ─────────────────────────────────────────────── */
.remember-row { display: flex; align-items: center; gap: 10px; cursor: pointer; position: relative; z-index: 1; }
.custom-check {
  width: 18px; height: 18px; border: 1.5px solid var(--border-strong);
  border-radius: var(--radius-sm); background: var(--bg-surface-2);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition:
    background var(--dur-fast) var(--ease-spring),
    border-color var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease-spring);
}
.custom-check:hover { transform: scale(1.1); }
.custom-check--on { background: var(--color-primary); border-color: var(--color-primary); transform: scale(1.05); }
.remember-label { font-size: 13px; color: var(--text-secondary); user-select: none; }

/* ── Error ────────────────────────────────────────────────── */
.login-error {
  display: flex; align-items: flex-start; gap: 8px; padding: 10px 14px;
  background: var(--color-error-dim);
  border: 1px solid rgba(var(--color-error-rgb), 0.22);
  border-radius: var(--radius-lg); font-size: 13px; color: var(--color-error);
  line-height: 1.4; position: relative; z-index: 1;
  animation: slide-up 220ms var(--ease-out) both;
}

/* ── Submit button ────────────────────────────────────────── */
.login-btn {
  height: 46px; width: 100%;
  background: linear-gradient(135deg, var(--color-primary), #6a5acd);
  background-size: 200% 200%;
  border: none; border-radius: var(--radius-lg);
  color: #fff; font-size: 14px; font-weight: 600; font-family: inherit;
  cursor: pointer; position: relative; overflow: hidden; margin-top: 4px;
  transition: transform var(--dur-fast) var(--ease-spring), box-shadow var(--dur-fast) var(--ease);
  box-shadow: 0 4px 18px rgba(var(--color-primary-rgb), 0.35);
  animation: gradient-shift 4s ease infinite;
}
.login-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 28px rgba(var(--color-primary-rgb), 0.45),
              0 0 0 1px rgba(var(--color-primary-rgb), 0.25);
}
.login-btn:active:not(:disabled) { transform: translateY(0) scale(0.97); }
.login-btn:disabled { opacity: 0.65; cursor: not-allowed; }

.btn-shine {
  position: absolute; top: 0; left: -100%; width: 60%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
  transform: skewX(-20deg); transition: left 0s; pointer-events: none;
}
.login-btn:hover:not(:disabled) .btn-shine { left: 160%; transition: left 0.55s ease; }

.login-btn__content {
  display: flex; align-items: center; justify-content: center; gap: 8px; position: relative; z-index: 1;
}

.orbit-loader {
  width: 18px; height: 18px;
  border: 2px solid rgba(255,255,255,0.25); border-radius: 50%;
  position: relative; flex-shrink: 0; animation: spin 1s linear infinite;
}
.orbit-dot {
  width: 5px; height: 5px; background: #fff; border-radius: 50%;
  position: absolute; top: -3px; left: 50%; transform: translateX(-50%);
}

/* ── Footer note ──────────────────────────────────────────── */
.login-note {
  margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border);
  font-size: 12px; color: var(--text-muted); line-height: 1.7;
  position: relative; z-index: 1;
}

/* ── Transitions ──────────────────────────────────────────── */
.login-in-enter-active { transition: opacity 480ms var(--ease-out), transform 480ms var(--ease-spring); }
.login-in-enter-from   { opacity: 0; transform: translateY(28px) scale(0.96); }

.fade-enter-active,.fade-leave-active { transition: opacity 200ms var(--ease); }
.fade-enter-from,.fade-leave-to       { opacity: 0; }

.theme-flip-enter-active { transition: all 300ms var(--ease-spring); }
.theme-flip-leave-active { transition: all 160ms var(--ease-in); }
.theme-flip-enter-from   { opacity: 0; transform: rotate(-90deg) scale(0.4); }
.theme-flip-leave-to     { opacity: 0; transform: rotate(90deg)  scale(0.4); }

.check-pop-enter-active { transition: all 240ms var(--ease-bounce); }
.check-pop-leave-active { transition: all 120ms var(--ease-in); }
.check-pop-enter-from   { opacity: 0; transform: scale(0); }
.check-pop-leave-to     { opacity: 0; transform: scale(0); }

/* ── Responsive ───────────────────────────────────────────── */
@media (max-width: 480px) {
  .login-card { padding: 28px 20px 22px; }
  .login-title { font-size: 20px; }
  .bg-orb--1 { width: 340px; height: 340px; }
  .bg-orb--2 { width: 280px; height: 280px; }
}
</style>
