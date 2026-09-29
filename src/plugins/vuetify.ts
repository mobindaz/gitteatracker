import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

// ── Shared component defaults ──────────────────────────────
const defaults = {
  VCard:               { rounded: 'xl',  elevation: 0 },
  VBtn:                { rounded: 'lg',  elevation: 0 },
  VTextField:          { rounded: 'lg',  variant: 'outlined' },
  VSelect:             { rounded: 'lg',  variant: 'outlined' },
  VAlert:              { rounded: 'xl' },
  VChip:               { rounded: 'md' },
  VDialog:             { rounded: 'xl' },
  VNavigationDrawer:   { rounded: 0 },
}

// ── Dark theme ─────────────────────────────────────────────
const giteaDark = {
  dark: true,
  colors: {
    background:       '#080a0f',
    surface:          '#0d1117',
    'surface-1':      '#111620',
    'surface-2':      '#161c2a',
    'surface-3':      '#1c2333',

    primary:          '#4f8ef7',
    'primary-subtle': '#1a2d4f',

    secondary:        '#7c8794',
    error:            '#f06672',
    'error-subtle':   '#2b1520',
    warning:          '#f0a44a',
    'warning-subtle': '#2b2010',
    success:          '#3dd68c',
    'success-subtle': '#0d2b1e',
    info:             '#4f8ef7',
    'info-subtle':    '#1a2d4f',

    'on-background':  '#e8eaf0',
    'on-surface':     '#e8eaf0',

    outline:          '#2a3347',
    'outline-variant':'#1e2838',
  },
  variables: {
    'shadow-key-umbra-opacity':       0.25,
    'shadow-key-penumbra-opacity':    0.12,
    'shadow-ambient-shadow-opacity':  0.10,
    'border-radius-root':             '10px',
    'medium-emphasis-opacity':        0.62,
    'disabled-opacity':               0.38,
    'border-opacity':                 0.12,
    'high-emphasis-opacity':          0.95,
  },
}

// ── Light theme ────────────────────────────────────────────
const giteaLight = {
  dark: false,
  colors: {
    background:       '#f0f4fb',
    surface:          '#ffffff',
    'surface-1':      '#f8fafd',
    'surface-2':      '#eef2f8',
    'surface-3':      '#e4eaf4',

    primary:          '#2563eb',
    'primary-subtle': '#dbeafe',

    secondary:        '#64748b',
    error:            '#dc2626',
    'error-subtle':   '#fee2e2',
    warning:          '#d97706',
    'warning-subtle': '#fef3c7',
    success:          '#16a34a',
    'success-subtle': '#dcfce7',
    info:             '#2563eb',
    'info-subtle':    '#dbeafe',

    'on-background':  '#0f172a',
    'on-surface':     '#0f172a',

    outline:          '#cbd5e1',
    'outline-variant':'#e2e8f0',
  },
  variables: {
    'shadow-key-umbra-opacity':       0.08,
    'shadow-key-penumbra-opacity':    0.05,
    'shadow-ambient-shadow-opacity':  0.04,
    'border-radius-root':             '10px',
    'medium-emphasis-opacity':        0.70,
    'disabled-opacity':               0.38,
    'border-opacity':                 0.14,
    'high-emphasis-opacity':          0.95,
  },
}

// ── Detect system preference ───────────────────────────────
function getSystemTheme(): 'giteaDark' | 'giteaLight' {
  if (typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'giteaLight'
  }
  return 'giteaDark'
}

export default createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: getSystemTheme(),
    themes: { giteaDark, giteaLight },
  },
  defaults,
})
