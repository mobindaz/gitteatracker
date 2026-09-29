<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useTimeTrackingStore } from '../stores/timeTracking'
import { useAuthStore } from '../stores/auth'
import {
  syncViaProxy,
  buildSheetRows,
  SHEET_HEADERS,
  PROXY_STORAGE_KEY,
  type ProxyConfig,
  type SyncProgress,
} from '../utils/sheetsProxy'
import { secondsToHours } from '../utils/dateUtils'

const store = useTimeTrackingStore()
const auth  = useAuthStore()

// ── Persisted config ────────────────────────────────────────
const webAppUrl = ref('')
const sheetUrl  = ref('')
const tabName   = ref('Work Details')
const setupDone = ref(false)

function loadConfig() {
  try {
    const raw = localStorage.getItem(PROXY_STORAGE_KEY)
    if (!raw) return
    const c = JSON.parse(raw)
    if (c.webAppUrl) { webAppUrl.value = c.webAppUrl; setupDone.value = true }
    if (c.sheetUrl)  sheetUrl.value = c.sheetUrl
    if (c.tabName)   tabName.value  = c.tabName
  } catch { /* ignore */ }
}
function saveConfig() {
  localStorage.setItem(PROXY_STORAGE_KEY, JSON.stringify({
    webAppUrl: webAppUrl.value, sheetUrl: sheetUrl.value, tabName: tabName.value,
  }))
  setupDone.value = !!webAppUrl.value.trim()
}
function resetSetup() {
  setupDone.value = false
  webAppUrl.value = ''
  localStorage.removeItem(PROXY_STORAGE_KEY)
}

// ── Date range ──────────────────────────────────────────────
const mode         = ref<'single' | 'range'>('single')
const selectedDate = ref(new Date().toISOString().split('T')[0])
const dateFrom     = ref('')
const dateTo       = ref('')

function iso(offsetDays = 0) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays)
  return d.toISOString().split('T')[0]
}
function week(offset: number): [string, string] {
  const t = new Date()
  const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7) + offset * 7)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  return [mon.toISOString().split('T')[0], sun.toISOString().split('T')[0]]
}
function month(): [string, string] {
  const t = new Date()
  return [new Date(t.getFullYear(), t.getMonth(), 1).toISOString().split('T')[0], iso(0)]
}

const activePreset = ref('today')
const presets = [
  { l: 'Today',      k: 'today',     fn: () => { selectedDate.value = iso(0);  mode.value = 'single' } },
  { l: 'Yesterday',  k: 'yesterday', fn: () => { selectedDate.value = iso(-1); mode.value = 'single' } },
  { l: 'This week',  k: 'thisweek',  fn: () => { const [a,b] = week(0);  dateFrom.value=a; dateTo.value=b; mode.value='range' } },
  { l: 'Last week',  k: 'lastweek',  fn: () => { const [a,b] = week(-1); dateFrom.value=a; dateTo.value=b; mode.value='range' } },
  { l: 'This month', k: 'thismonth', fn: () => { const [a,b] = month();  dateFrom.value=a; dateTo.value=b; mode.value='range' } },
]
function applyPreset(p: typeof presets[0]) { activePreset.value = p.k; p.fn() }

// ── Filtered entries ────────────────────────────────────────
const filteredEntries = computed(() => {
  const me = auth.username || auth.profile?.login || ''
  let e = me
    ? store.entries.filter(x => x.user_name === me || x.user_name.toLowerCase() === me.toLowerCase())
    : store.entries
  if (mode.value === 'range' && dateFrom.value && dateTo.value) {
    const from = new Date(dateFrom.value).getTime()
    const to   = new Date(dateTo.value).getTime() + 86400000
    e = e.filter(x => { const t = new Date(x.created).getTime(); return t >= from && t < to })
  } else if (selectedDate.value) {
    e = e.filter(x => x.created.split('T')[0] === selectedDate.value)
  }
  return e.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
})

const rangeFromIso = computed(() =>
  mode.value === 'range' && dateFrom.value ? dateFrom.value : selectedDate.value
)

// ── Distinct tickets in range ───────────────────────────────
const allTicketOptions = computed(() => {
  const seen = new Map<string, { id: string; title: string; num: number }>()
  for (const e of filteredEntries.value) {
    const issue = store.issues.find(i => i.id === e.issue_id)
    const num   = e.issue?.number ?? issue?.number ?? e.issue_id
    const idStr = String(num)
    if (!seen.has(idStr)) seen.set(idStr, { id: idStr, title: e.issue?.title ?? issue?.title ?? 'Unknown', num })
  }
  return Array.from(seen.values()).sort((a, b) => a.num - b.num)
})

// ── Exclude tickets ─────────────────────────────────────────
const excludedIds    = ref<string[]>([])
const excludeInput   = ref('')
const showSuggest    = ref(false)
const excludeInputEl = ref<HTMLInputElement | null>(null)

const suggestions = computed(() => {
  const q = excludeInput.value.replace(/^#/, '').trim().toLowerCase()
  return allTicketOptions.value
    .filter(t => !excludedIds.value.includes(t.id) && (q === '' || t.id.includes(q) || t.title.toLowerCase().includes(q)))
    .slice(0, 8)
})

function addExclude(id: string) {
  if (!excludedIds.value.includes(id)) excludedIds.value.push(id)
  excludeInput.value = ''
  showSuggest.value  = false
  nextTick(() => excludeInputEl.value?.focus())
}
function removeExclude(id: string) { excludedIds.value = excludedIds.value.filter(x => x !== id) }
function onExcludeBlur() { window.setTimeout(() => { showSuggest.value = false }, 160) }
function onExcludeKey(e: KeyboardEvent) {
  if (e.key === 'Backspace' && !excludeInput.value && excludedIds.value.length) excludedIds.value.pop()
  if (e.key === 'Escape') showSuggest.value = false
  if (e.key === 'Enter' && suggestions.value.length) { addExclude(suggestions.value[0].id); e.preventDefault() }
}
function getTitle(id: string) { return allTicketOptions.value.find(t => t.id === id)?.title ?? '' }

// ── Preview rows ────────────────────────────────────────────
const previewRows = computed(() =>
  buildSheetRows(filteredEntries.value, store.issues, auth.username, rangeFromIso.value)
    .filter(r => !excludedIds.value.includes(r.taskId.replace(/^#/, '')))
)

// ── Stats ───────────────────────────────────────────────────
const stats = computed(() => {
  const rows    = previewRows.value.length
  const tickets = new Set(previewRows.value.map(r => r.taskId)).size
  const hours   = filteredEntries.value
    .filter(e => {
      const num = String(e.issue?.number ?? store.issues.find(i => i.id === e.issue_id)?.number ?? e.issue_id)
      return !excludedIds.value.includes(num)
    })
    .reduce((s, e) => s + secondsToHours(e.time), 0)
  return { rows, tickets, hours }
})

// ── Date label ──────────────────────────────────────────────
function fmtD(d: string) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`
}
const dateLabel = computed(() => {
  if (mode.value === 'range' && dateFrom.value && dateTo.value)
    return `${fmtD(dateFrom.value)} – ${fmtD(dateTo.value)}`
  return fmtD(selectedDate.value) || '—'
})

// ── Sync ────────────────────────────────────────────────────
const progress  = ref<SyncProgress>({ stage: 'idle', message: '' })
const syncError = ref('')
const isSyncing = computed(() => ['building', 'sending'].includes(progress.value.stage))

async function runSync() {
  syncError.value = ''
  progress.value  = { stage: 'idle', message: '' }
  if (!setupDone.value)       { syncError.value = 'Complete the Apps Script setup first (Step 1).'; return }
  if (!sheetUrl.value.trim()) { syncError.value = 'Enter the Google Sheets URL (Step 2).'; return }
  if (!tabName.value.trim())  { syncError.value = 'Enter a sheet tab name (Step 2).'; return }
  if (stats.value.rows === 0) { syncError.value = 'No rows to export for the selected filters.'; return }
  saveConfig()
  try {
    await syncViaProxy(
      { webAppUrl: webAppUrl.value.trim(), sheetUrl: sheetUrl.value.trim(), tabName: tabName.value.trim() },
      filteredEntries.value, store.issues, auth.username, rangeFromIso.value,
      p => { progress.value = p },
      excludedIds.value
    )
  } catch (e: any) {
    progress.value = { stage: 'error', message: '' }
    syncError.value = e.message ?? 'An unexpected error occurred.'
  }
}

// ── Dialogs ─────────────────────────────────────────────────
const showColsDialog    = ref(false)
const showPreviewDialog = ref(false)

// ── Apps Script ─────────────────────────────────────────────
const showScript = ref(false)
const copied     = ref(false)

const appsScript = `function doPost(e) {
  try {
    var data = e.parameter.payload
      ? JSON.parse(e.parameter.payload)
      : JSON.parse(e.postData.contents);
    var ss  = SpreadsheetApp.openById(data.spreadsheetId);
    var tab = ss.getSheetByName(data.tabName)
            || ss.insertSheet(data.tabName);

    var existing = tab.getDataRange().getValues();

    // ── Check / write header ──────────────────────────────
    // Write header if sheet is empty OR first cell doesn't match our header.
    // This handles: brand-new sheets, manually created empty tabs, and tabs
    // opened by other team members who didn't have the header yet.
    var hasHeader = existing.length > 0
      && existing[0][0] === data.headers[0]
      && existing[0][data.headers.length - 1] === data.headers[data.headers.length - 1];

    if (!hasHeader) {
      if (existing.length === 0) {
        // Sheet is completely empty — just append header at row 1
        tab.appendRow(data.headers);
      } else {
        // Sheet has data but no matching header — insert header at row 1
        tab.insertRowsBefore(1, 1);
        tab.getRange(1, 1, 1, data.headers.length).setValues([data.headers]);
        // Re-read so our key-building loop below starts at row index 1
        existing = tab.getDataRange().getValues();
      }
      var hRange = tab.getRange(1, 1, 1, data.headers.length);
      hRange.setBackground('#1F3369')
            .setFontColor('#FFFFFF')
            .setFontWeight('bold')
            .setFontSize(10);
      tab.setFrozenRows(1);
      tab.autoResizeColumns(1, data.headers.length);
    }

    // ── Deduplicate ───────────────────────────────────────
    // Skip row 0 (header). Key = TaskID || Date || Programmer
    var keys = {};
    for (var i = 1; i < existing.length; i++) {
      var r = existing[i];
      if (r[0]) keys[r[0] + '||' + r[2] + '||' + r[3]] = true;
    }
    var newRows = data.rows.filter(function(r) {
      return !keys[r[0] + '||' + r[2] + '||' + r[3]];
    });

    if (newRows.length > 0) {
      // Insert a blank spacer ABOVE the new batch (row 2 = just below header)
      // and another blank spacer BELOW the batch, so each sync group is
      // visually separated from the content above and below.
      var insertAt = 2; // just below header
      var totalInsert = 1 + newRows.length + 1; // spacer + data + spacer
      tab.insertRowsBefore(insertAt, totalInsert);

      // Top spacer row (row 2) — left blank intentionally
      // Data rows start at row 3
      tab.getRange(insertAt + 1, 1, newRows.length, data.headers.length)
         .setValues(newRows);

      // Thick top border on the FIRST data row (row 3) — marks batch start
      tab.getRange(insertAt + 1, 1, 1, data.headers.length)
         .setBorder(
           true, false, false, false, false, false,
           '#1F3369', SpreadsheetApp.BorderStyle.SOLID_THICK
         );

      // Thick bottom border on the LAST data row — marks batch end
      tab.getRange(insertAt + newRows.length, 1, 1, data.headers.length)
         .setBorder(
           false, false, true, false, false, false,
           '#1F3369', SpreadsheetApp.BorderStyle.SOLID_THICK
         );

      // Bottom spacer row (insertAt + newRows.length + 1) — left blank
    }

    var dataRowCount = existing.length > 0 ? existing.length - 1 : 0;
    return ContentService.createTextOutput(
      JSON.stringify({ ok: true, inserted: newRows.length, skipped: dataRowCount - (dataRowCount - (data.rows.length - newRows.length)) })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}`

function copyScript() {
  navigator.clipboard.writeText(appsScript)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2200)
}

onMounted(() => { loadConfig(); store.fetchAll() })
</script>

<template>
  <div class="sx">

    <!-- ══ HERO HEADER ════════════════════════════════════════ -->
    <div class="sx-hero">
      <div class="sx-hero__orb" aria-hidden="true" />
      <div class="sx-hero__left">
        <div class="sx-hero__icon">
          <v-icon size="24" color="success">mdi-google-spreadsheet</v-icon>
        </div>
        <div>
          <h1 class="sx-hero__title">Sheets Export</h1>
          <p class="sx-hero__sub">
            <strong>{{ auth.profile?.full_name || auth.username }}</strong>
            <span class="sx-hero__sep">·</span>
            {{ dateLabel }}
          </p>
        </div>
        <div v-if="setupDone" class="sx-hero__badge">
          <span class="sx-pulse-dot" />
          Script connected
        </div>
      </div>

      <div class="sx-hero__right">
        <!-- KPI row -->
        <div class="sx-kpis">
          <div class="sx-kpi">
            <span class="sx-kpi__val">
              <span v-if="store.loading && !store.entries.length" class="sx-kpi__skel" />
              <template v-else>{{ stats.rows }}</template>
            </span>
            <span class="sx-kpi__lbl">Rows</span>
          </div>
          <div class="sx-kpi-sep" />
          <div class="sx-kpi">
            <span class="sx-kpi__val">
              <span v-if="store.loading && !store.entries.length" class="sx-kpi__skel" />
              <template v-else>{{ stats.tickets }}</template>
            </span>
            <span class="sx-kpi__lbl">Tickets</span>
          </div>
          <div class="sx-kpi-sep" />
          <div class="sx-kpi">
            <span class="sx-kpi__val">
              <span v-if="store.loading && !store.entries.length" class="sx-kpi__skel" />
              <template v-else>{{ stats.hours.toFixed(1) }}h</template>
            </span>
            <span class="sx-kpi__lbl">Hours</span>
          </div>
        </div>

        <!-- Sync CTA -->
        <button
          class="sx-sync-btn"
          :disabled="isSyncing || !setupDone || stats.rows === 0"
          @click="runSync"
        >
          <template v-if="isSyncing">
            <v-icon size="17" class="sx-spin">mdi-loading</v-icon>
            Syncing…
          </template>
          <template v-else>
            <v-icon size="17">mdi-upload-outline</v-icon>
            Sync {{ stats.rows }} row{{ stats.rows !== 1 ? 's' : '' }}
          </template>
        </button>
      </div>
    </div>

    <!-- ══ FEEDBACK ═══════════════════════════════════════════ -->
    <transition name="sx-fade">
      <div v-if="isSyncing || progress.stage === 'done' || syncError || store.loadError" class="sx-feedback">
        <div v-if="store.loadError" class="sx-fb sx-fb--err">
          <v-icon size="15" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
          {{ store.loadError }}
          <button class="sx-fb__btn" @click="store.forceRefresh()"><v-icon size="13">mdi-refresh</v-icon> Retry</button>
        </div>
        <div v-else-if="syncError" class="sx-fb sx-fb--err">
          <v-icon size="15" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
          <span>{{ syncError }}</span>
        </div>
        <div v-else-if="isSyncing" class="sx-fb sx-fb--progress">
          <div class="sx-fb__track"><div class="sx-fb__fill" :class="`sx-p--${progress.stage}`" /></div>
          <span class="sx-fb__msg">{{ progress.message }}</span>
        </div>
        <div v-else-if="progress.stage === 'done'" class="sx-fb sx-fb--ok">
          <v-icon size="16" color="success">mdi-check-circle-outline</v-icon>
          <span>{{ progress.message }}</span>
          <span v-if="(progress.skipped ?? 0) > 0" class="sx-fb__note">
            · {{ progress.skipped }} duplicate{{ progress.skipped !== 1 ? 's' : '' }} skipped
          </span>
          <a v-if="sheetUrl" :href="sheetUrl" target="_blank" rel="noopener" class="sx-fb__link">
            <v-icon size="13">mdi-open-in-new</v-icon> Open sheet
          </a>
        </div>
      </div>
    </transition>

    <!-- ══ 2-COLUMN LAYOUT ════════════════════════════════════ -->
    <div class="sx-body">

      <!-- ── LEFT: DATE + EXCLUDE ──────────────────────────── -->
      <div class="sx-left">

        <!-- Date Range -->
        <section class="sx-section">
          <div class="sx-section__hdr">
            <div class="sx-section__ico sx-section__ico--primary">
              <v-icon size="16" color="primary">mdi-calendar-range</v-icon>
            </div>
            <h2 class="sx-section__title">Date Range</h2>
          </div>

          <div class="sx-presets">
            <button
              v-for="p in presets" :key="p.k"
              class="sx-preset" :class="{ 'sx-preset--on': activePreset === p.k }"
              @click="applyPreset(p)"
            >{{ p.l }}</button>
          </div>

          <div class="sx-toggle">
            <button class="sx-toggle__btn" :class="{ 'sx-toggle__btn--on': mode === 'single' }" @click="mode = 'single'; activePreset = ''">Single date</button>
            <button class="sx-toggle__btn" :class="{ 'sx-toggle__btn--on': mode === 'range' }" @click="mode = 'range'; activePreset = ''">Date range</button>
          </div>

          <div class="sx-dates">
            <div class="sx-date-field">
              <label class="sx-date-lbl">{{ mode === 'single' ? 'Date' : 'From' }}</label>
              <div class="sx-date-wrap">
                <v-icon size="15" class="sx-date-ico">mdi-calendar-outline</v-icon>
                <input v-if="mode === 'single'" v-model="selectedDate" type="date" class="sx-date-inp" />
                <input v-else v-model="dateFrom" type="date" class="sx-date-inp" />
              </div>
            </div>
            <div v-if="mode === 'range'" class="sx-date-field">
              <label class="sx-date-lbl">To</label>
              <div class="sx-date-wrap">
                <v-icon size="15" class="sx-date-ico">mdi-calendar-outline</v-icon>
                <input v-model="dateTo" type="date" class="sx-date-inp" />
              </div>
            </div>
          </div>
        </section>

        <!-- Exclude Tickets -->
        <section class="sx-section">
          <div class="sx-section__hdr">
            <div class="sx-section__ico sx-section__ico--error">
              <v-icon size="16" color="error">mdi-cancel</v-icon>
            </div>
            <h2 class="sx-section__title">Exclude Tickets</h2>
            <span v-if="excludedIds.length" class="sx-badge sx-badge--red">{{ excludedIds.length }}</span>
          </div>
          <p class="sx-section__desc">Search and tag tickets to skip from this export.</p>

          <div class="sx-exclude" :class="{ 'sx-exclude--focus': showSuggest }" @click="excludeInputEl?.focus()">
            <div class="sx-exclude__tags">
              <span v-for="id in excludedIds" :key="id" class="sx-tag">
                <span class="sx-tag__id">#{{ id }}</span>
                <span class="sx-tag__text">{{ getTitle(id) }}</span>
                <button class="sx-tag__del" @click.stop="removeExclude(id)"><v-icon size="11">mdi-close</v-icon></button>
              </span>
              <input
                ref="excludeInputEl"
                v-model="excludeInput"
                class="sx-exclude__inp"
                placeholder="Ticket number or title…"
                autocomplete="off"
                spellcheck="false"
                @focus="showSuggest = true"
                @blur="onExcludeBlur"
                @keydown="onExcludeKey"
              />
            </div>
          </div>
          <transition name="sx-drop">
            <div v-if="showSuggest && suggestions.length" class="sx-suggest">
              <button
                v-for="s in suggestions" :key="s.id"
                class="sx-suggest__row"
                @mousedown.prevent="addExclude(s.id)"
              >
                <span class="sx-suggest__id">#{{ s.id }}</span>
                <span class="sx-suggest__title">{{ s.title }}</span>
              </button>
            </div>
          </transition>
          <p class="sx-hint">Press <kbd>Enter</kbd> to add · <kbd>Backspace</kbd> to remove last</p>
        </section>

        <!-- View buttons -->
        <div class="sx-view-btns">
          <button class="sx-view-btn" @click="showColsDialog = true">
            <v-icon size="16" color="success">mdi-table-column</v-icon>
            <span>View {{ SHEET_HEADERS.length }} columns</span>
            <v-icon size="14" class="sx-view-btn__arrow">mdi-chevron-right</v-icon>
          </button>
          <button
            class="sx-view-btn"
            :disabled="previewRows.length === 0"
            @click="showPreviewDialog = true"
          >
            <v-icon size="16" color="primary">mdi-eye-outline</v-icon>
            <span>Preview {{ stats.rows }} row{{ stats.rows !== 1 ? 's' : '' }}</span>
            <v-icon size="14" class="sx-view-btn__arrow">mdi-chevron-right</v-icon>
          </button>
        </div>

      </div><!-- /sx-left -->

      <!-- ── RIGHT: SETUP ───────────────────────────────────── -->
      <div class="sx-right">

        <!-- Step 1: Apps Script -->
        <section class="sx-section" :class="{ 'sx-section--done': setupDone }">
          <div class="sx-section__hdr">
            <div class="sx-step" :class="{ 'sx-step--done': setupDone }">
              <v-icon v-if="setupDone" size="13">mdi-check</v-icon>
              <span v-else>1</span>
            </div>
            <h2 class="sx-section__title">Apps Script Setup</h2>
            <span class="sx-section__meta">One-time · never changes</span>
            <button v-if="setupDone" class="sx-ico-btn" @click="resetSetup" title="Edit">
              <v-icon size="14">mdi-pencil-outline</v-icon>
            </button>
          </div>

          <template v-if="!setupDone">
            <div class="sx-steps-list">
              <div class="sx-step-item"><span class="sx-step-item__n">1</span><span>Open your Google Sheet → <strong>Extensions → Apps Script</strong></span></div>
              <div class="sx-step-item"><span class="sx-step-item__n">2</span><span>Delete existing code, paste the script, save <kbd>Ctrl+S</kbd></span></div>
              <div class="sx-step-item"><span class="sx-step-item__n">3</span><span><strong>Deploy → New deployment</strong> → Type: <em>Web app</em></span></div>
              <div class="sx-step-item"><span class="sx-step-item__n">4</span><span>Execute as: <strong>Me</strong> · Who has access: <strong>Anyone</strong></span></div>
              <div class="sx-step-item"><span class="sx-step-item__n">5</span><span>Copy the <strong>Web App URL</strong>, paste below</span></div>
            </div>

            <div class="sx-script-box">
              <div class="sx-script-box__bar">
                <button class="sx-ghost-btn" @click="showScript = !showScript">
                  <v-icon size="13">{{ showScript ? 'mdi-chevron-up' : 'mdi-code-tags' }}</v-icon>
                  {{ showScript ? 'Hide script' : 'View script' }}
                </button>
                <button class="sx-green-btn sx-green-btn--sm" @click="copyScript">
                  <v-icon size="12">{{ copied ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
                  {{ copied ? 'Copied!' : 'Copy script' }}
                </button>
              </div>
              <transition name="sx-fade">
                <pre v-if="showScript" class="sx-code">{{ appsScript }}</pre>
              </transition>
            </div>

            <div class="sx-field">
              <label class="sx-lbl">Web App URL</label>
              <div class="sx-field__row">
                <input v-model="webAppUrl" class="sx-input" placeholder="https://script.google.com/macros/s/…/exec" spellcheck="false" />
                <button class="sx-green-btn" :disabled="!webAppUrl.trim()" @click="saveConfig">
                  <v-icon size="15">mdi-check</v-icon> Save
                </button>
              </div>
              <p class="sx-hint">Saved locally — never expires or changes.</p>
            </div>
          </template>

          <template v-else>
            <div class="sx-connected">
              <v-icon size="18" color="success">mdi-check-circle</v-icon>
              <div>
                <p class="sx-connected__title">Connected</p>
                <p class="sx-connected__url">{{ webAppUrl }}</p>
              </div>
            </div>
          </template>
        </section>

        <!-- Step 2: Spreadsheet -->
        <section class="sx-section" :class="{ 'sx-section--done': sheetUrl && tabName }">
          <div class="sx-section__hdr">
            <div class="sx-step" :class="{ 'sx-step--done': sheetUrl && tabName }">
              <v-icon v-if="sheetUrl && tabName" size="13">mdi-check</v-icon>
              <span v-else>2</span>
            </div>
            <h2 class="sx-section__title">Spreadsheet</h2>
            <span class="sx-section__meta">Where to write the data</span>
          </div>

          <div class="sx-field">
            <label class="sx-lbl">Google Sheets URL</label>
            <input v-model="sheetUrl" class="sx-input" placeholder="https://docs.google.com/spreadsheets/d/…/edit" spellcheck="false" />
            <p class="sx-hint">Must be owned by the Google account that deployed the script.</p>
          </div>

          <div class="sx-field">
            <label class="sx-lbl">Sheet Tab Name</label>
            <input v-model="tabName" class="sx-input" placeholder="Work Details" spellcheck="false" />
            <p class="sx-hint">Tab is created automatically if it doesn't exist.</p>
          </div>
        </section>

      </div><!-- /sx-right -->

    </div><!-- /sx-body -->

    <!-- ══ COLUMNS DIALOG ══════════════════════════════════════ -->
    <v-dialog v-model="showColsDialog" max-width="560">
      <div class="sx-dialog">
        <div class="sx-dialog__hdr">
          <div class="sx-dialog__icon">
            <v-icon size="18" color="success">mdi-table-column</v-icon>
          </div>
          <div>
            <h3 class="sx-dialog__title">Columns Exported</h3>
            <p class="sx-dialog__sub">{{ SHEET_HEADERS.length }} columns written to Google Sheets</p>
          </div>
          <button class="sx-dialog__close" @click="showColsDialog = false"><v-icon size="16">mdi-close</v-icon></button>
        </div>

        <div class="sx-cols-list">
          <div v-for="(col, i) in SHEET_HEADERS" :key="col" class="sx-col">
            <div class="sx-col__letter">{{ String.fromCharCode(65 + i) }}</div>
            <div class="sx-col__body">
              <span class="sx-col__name">{{ col }}</span>
            </div>
          </div>
        </div>
      </div>
    </v-dialog>

    <!-- ══ PREVIEW DIALOG ══════════════════════════════════════ -->
    <v-dialog v-model="showPreviewDialog" max-width="900">
      <div class="sx-dialog">
        <div class="sx-dialog__hdr">
          <div class="sx-dialog__icon">
            <v-icon size="18" color="primary">mdi-eye-outline</v-icon>
          </div>
          <div>
            <h3 class="sx-dialog__title">Data Preview</h3>
            <p class="sx-dialog__sub">{{ previewRows.length }} row{{ previewRows.length !== 1 ? 's' : '' }} · {{ dateLabel }}</p>
          </div>
          <button class="sx-dialog__close" @click="showPreviewDialog = false"><v-icon size="16">mdi-close</v-icon></button>
        </div>

        <div v-if="previewRows.length === 0" class="sx-empty">
          <v-icon size="40" color="secondary">mdi-table-off</v-icon>
          <p>No data for the selected date range.</p>
        </div>

        <div v-else class="sx-tbl-wrap">
          <table class="sx-tbl">
            <thead>
              <tr>
                <th>ID</th><th>Title</th><th>Date</th><th>Programmer</th>
                <th>Status</th><th>Est. Hrs</th><th>Act. Hrs</th><th>Est. Start</th><th>Est. End</th><th>CF</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in previewRows" :key="i">
                <td class="mono">{{ r.taskId }}</td>
                <td class="trunc" style="max-width:200px">{{ r.description }}</td>
                <td class="mono">{{ r.date }}</td>
                <td class="trunc">{{ r.programmer }}</td>
                <td>
                  <span class="sx-pill" :class="r.status === 'Completed' ? 'sx-pill--done' : 'sx-pill--wip'">
                    {{ r.status }}
                  </span>
                </td>
                <td class="mono">{{ r.estimatedHrs }}</td>
                <td class="mono">{{ r.actualHrs }}</td>
                <td class="mono">{{ r.estStartDate }}</td>
                <td class="mono">{{ r.estEndDate }}</td>
                <td class="mono" style="text-align:center">
                  <span :class="r.carryForwarded === 'Y' ? 'sx-cf--y' : 'sx-cf--n'">{{ r.carryForwarded }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </v-dialog>

  </div>
</template>

<style scoped>
/* ── Shell ───────────────────────────────────────────────── */
.sx { display: flex; flex-direction: column; gap: 20px; width: 100%; padding-bottom: 40px; }

/* ══ HERO ════════════════════════════════════════════════════ */
.sx-hero {
  position: relative; overflow: hidden;
  background: linear-gradient(135deg, rgba(52,168,83,.1), rgba(52,168,83,.03) 60%);
  border: 1px solid rgba(52,168,83,.22); border-radius: var(--radius-xl);
  padding: 22px 26px; display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
  animation: sx-in 320ms var(--ease-out) both;
}
@keyframes sx-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
.sx-hero__orb {
  position: absolute; width: 200px; height: 200px; border-radius: 50%;
  background: radial-gradient(circle, rgba(52,168,83,.14), transparent 70%);
  top: -60px; right: 80px; pointer-events: none;
}
.sx-hero__left { display: flex; align-items: center; gap: 16px; flex: 1; min-width: 0; }
.sx-hero__icon {
  width: 52px; height: 52px; border-radius: 16px; flex-shrink: 0;
  background: rgba(52,168,83,.18); border: 1px solid rgba(52,168,83,.3);
  display: flex; align-items: center; justify-content: center;
}
.sx-hero__title { font-size: 20px; font-weight: 800; color: var(--text-primary); letter-spacing: -.025em; margin: 0 0 5px; }
.sx-hero__sub { font-size: 13px; color: var(--text-secondary); margin: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sx-hero__sub strong { color: var(--text-primary); }
.sx-hero__sep { color: var(--text-muted); }
.sx-hero__badge {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 99px;
  background: rgba(52,168,83,.12); border: 1px solid rgba(52,168,83,.25); font-size: 12px; font-weight: 600; color: #34a853; white-space: nowrap;
}
.sx-pulse-dot { width: 7px; height: 7px; border-radius: 50%; background: #34a853; flex-shrink: 0; animation: sdot 2s ease-in-out infinite; }
@keyframes sdot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.35)} }

.sx-hero__right { display: flex; align-items: center; gap: 16px; flex-shrink: 0; }

/* KPIs */
.sx-kpis { display: flex; align-items: stretch; background: var(--bg-surface-1); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.sx-kpi { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 12px 18px; }
.sx-kpi__val { font-size: 22px; font-weight: 800; color: var(--text-primary); letter-spacing: -.03em; line-height: 1; font-variant-numeric: tabular-nums; min-height: 26px; display: flex; align-items: center; }
.sx-kpi__skel { display: inline-block; width: 36px; height: 22px; border-radius: 5px; background: linear-gradient(90deg, rgba(var(--color-primary-rgb),.05) 25%, rgba(var(--color-primary-rgb),.1) 50%, rgba(var(--color-primary-rgb),.05) 75%); background-size: 600px 100%; animation: shimmer 1.8s linear infinite; }
.sx-kpi__lbl { font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .07em; }
.sx-kpi-sep { width: 1px; background: var(--border); flex-shrink: 0; }
@keyframes shimmer { 0%{background-position:-600px 0} 100%{background-position:600px 0} }

/* Sync button */
.sx-sync-btn {
  display: inline-flex; align-items: center; gap: 9px;
  height: 48px; padding: 0 24px;
  background: #34a853; border: none; border-radius: var(--radius-lg);
  color: #fff; font-size: 15px; font-weight: 700; font-family: inherit; cursor: pointer;
  box-shadow: 0 4px 16px rgba(52,168,83,.35);
  transition: background 130ms, transform 130ms, box-shadow 130ms;
  white-space: nowrap;
}
.sx-sync-btn:hover:not(:disabled) { background: #2e9647; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(52,168,83,.45); }
.sx-sync-btn:active { transform: scale(0.97); }
.sx-sync-btn:disabled { opacity: .45; cursor: not-allowed; transform: none; box-shadow: none; }
.sx-spin { animation: spin .75s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ══ FEEDBACK ════════════════════════════════════════════════ */
.sx-feedback { animation: sx-in 200ms var(--ease-out) both; }
.sx-fb {
  display: flex; align-items: center; gap: 10px; padding: 14px 18px;
  border-radius: var(--radius-xl); font-size: 13.5px;
}
.sx-fb--err  { background: var(--color-error-dim); border: 1px solid rgba(240,102,114,.2); color: var(--color-error); }
.sx-fb--ok   { background: rgba(52,168,83,.1); border: 1px solid rgba(52,168,83,.22); color: #34a853; font-weight: 500; }
.sx-fb--progress { background: var(--bg-surface-1); border: 1px solid var(--border); flex-direction: column; align-items: stretch; gap: 8px; }
.sx-fb__track { height: 4px; background: var(--bg-surface-3); border-radius: 99px; overflow: hidden; }
.sx-fb__fill { height: 100%; border-radius: 99px; background: #34a853; }
.sx-p--building { width: 35%; animation: ind 1.4s ease-in-out infinite; }
.sx-p--sending  { width: 72%; animation: ind 1.4s ease-in-out infinite; }
@keyframes ind { 0%{transform:translateX(-100%)} 50%{transform:translateX(0)} 100%{transform:translateX(100%)} }
.sx-fb__msg  { font-size: 12.5px; color: var(--text-secondary); }
.sx-fb__note { opacity: .75; font-size: 12px; }
.sx-fb__link {
  margin-left: auto; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 700; color: #34a853; text-decoration: none;
  padding: 3px 11px; border: 1px solid rgba(52,168,83,.3); border-radius: 99px;
  background: rgba(52,168,83,.1); transition: background 120ms;
}
.sx-fb__link:hover { background: rgba(52,168,83,.2); }
.sx-fb__btn {
  margin-left: auto; display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 600; color: inherit; background: none;
  border: 1px solid currentColor; border-radius: var(--radius-md); padding: 2px 8px; cursor: pointer;
  font-family: inherit; transition: background 120ms;
}
.sx-fb__btn:hover { background: rgba(240,102,114,.1); }

/* ══ BODY LAYOUT ═════════════════════════════════════════════ */
.sx-body { display: grid; grid-template-columns: 360px 1fr; gap: 20px; align-items: start; }
.sx-left  { display: flex; flex-direction: column; gap: 16px; position: sticky; top: 16px; }
.sx-right { display: flex; flex-direction: column; gap: 16px; }

/* ══ SECTION CARD ════════════════════════════════════════════ */
.sx-section {
  background: var(--bg-surface-1); border: 1px solid var(--border);
  border-radius: var(--radius-xl); padding: 20px 22px;
  display: flex; flex-direction: column; gap: 16px;
  transition: border-color 220ms;
  animation: sx-in 380ms var(--ease-out) both;
}
.sx-section:nth-child(2) { animation-delay: 50ms; }
.sx-section:nth-child(3) { animation-delay: 100ms; }
.sx-section:hover { border-color: var(--border-strong); }
.sx-section--done { border-color: rgba(52,168,83,.22); }

.sx-section__hdr { display: flex; align-items: center; gap: 11px; }
.sx-section__ico {
  width: 34px; height: 34px; flex-shrink: 0; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.sx-section__ico--primary { background: var(--color-primary-dim); border: 1px solid rgba(var(--color-primary-rgb),.2); }
.sx-section__ico--error   { background: var(--color-error-dim); border: 1px solid rgba(240,102,114,.2); }

.sx-section__title { font-size: 15px; font-weight: 700; color: var(--text-primary); margin: 0; letter-spacing: -.01em; flex: 1; }
.sx-section__meta  { font-size: 11.5px; color: var(--text-muted); white-space: nowrap; }
.sx-section__desc  { font-size: 13px; color: var(--text-secondary); margin: -8px 0 0; }

.sx-badge { padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 700; }
.sx-badge--red { background: var(--color-error-dim); color: var(--color-error); border: 1px solid rgba(240,102,114,.2); }

/* Step badge */
.sx-step {
  width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
  background: var(--bg-surface-3); border: 1.5px solid var(--border-strong);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800; color: var(--text-muted); transition: all 220ms;
}
.sx-step--done { background: rgba(52,168,83,.15); border-color: rgba(52,168,83,.35); color: #34a853; }

.sx-ico-btn {
  width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0;
  border: 1px solid var(--border); background: none; color: var(--text-muted);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background 120ms, color 120ms;
}
.sx-ico-btn:hover { background: var(--bg-surface-2); color: var(--text-primary); }

/* ── Presets ──────────────────────────────────────────────── */
.sx-presets { display: flex; flex-wrap: wrap; gap: 7px; }
.sx-preset {
  height: 34px; padding: 0 14px;
  background: var(--bg-surface-2); border: 1px solid var(--border);
  border-radius: 99px; color: var(--text-secondary);
  font-size: 13px; font-weight: 500; font-family: inherit; cursor: pointer;
  transition: background 120ms, color 120ms, border-color 120ms, transform 100ms;
}
.sx-preset:hover { background: rgba(52,168,83,.08); border-color: rgba(52,168,83,.25); color: #34a853; transform: translateY(-1px); }
.sx-preset--on { background: rgba(52,168,83,.14); border-color: rgba(52,168,83,.3); color: #34a853; font-weight: 700; }

/* ── Mode toggle ──────────────────────────────────────────── */
.sx-toggle {
  display: flex; background: var(--bg-surface-2); border: 1px solid var(--border);
  border-radius: 11px; padding: 3px; gap: 2px;
}
.sx-toggle__btn {
  flex: 1; height: 34px; border: none; background: transparent; border-radius: 8px;
  color: var(--text-muted); font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: background 120ms, color 120ms;
}
.sx-toggle__btn:hover { color: var(--text-secondary); }
.sx-toggle__btn--on { background: var(--bg-surface-3); color: var(--text-primary); box-shadow: var(--shadow-sm); }

/* ── Date inputs ──────────────────────────────────────────── */
.sx-dates { display: flex; flex-direction: column; gap: 10px; }
.sx-date-field { display: flex; flex-direction: column; gap: 5px; }
.sx-date-lbl { font-size: 11.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .07em; }
.sx-date-wrap { position: relative; display: flex; align-items: center; }
.sx-date-ico { position: absolute; left: 12px; pointer-events: none; color: var(--text-muted); }
.sx-date-inp {
  width: 100%; height: 46px; padding: 0 14px 0 36px;
  background: var(--bg-surface-2); border: 1.5px solid var(--border-strong);
  border-radius: var(--radius-lg); color: var(--text-primary);
  font-size: 15px; font-family: 'JetBrains Mono', monospace; outline: none; color-scheme: dark;
  transition: border-color 200ms, box-shadow 200ms;
}
.sx-date-inp:focus { border-color: rgba(52,168,83,.5); box-shadow: 0 0 0 3px rgba(52,168,83,.1); }

/* ── Exclude box ──────────────────────────────────────────── */
.sx-exclude {
  min-height: 52px; border-radius: var(--radius-lg);
  background: var(--bg-surface-2); border: 1.5px solid var(--border-strong);
  cursor: text; position: relative;
  transition: border-color 200ms, box-shadow 200ms;
}
.sx-exclude--focus { border-color: rgba(52,168,83,.5); box-shadow: 0 0 0 3px rgba(52,168,83,.1); }
.sx-exclude__tags { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; align-items: center; }
.sx-tag {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 5px 3px 9px;
  border-radius: 7px; background: var(--color-error-dim); border: 1px solid rgba(240,102,114,.25);
  font-size: 12px; color: var(--color-error); animation: sx-in 150ms var(--ease-out) both; max-width: 220px;
}
.sx-tag__id { font-family: 'JetBrains Mono',monospace; font-weight: 800; font-size: 11.5px; flex-shrink: 0; }
.sx-tag__text { font-size: 11px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sx-tag__del {
  width: 18px; height: 18px; border-radius: 4px; border: none; flex-shrink: 0;
  background: rgba(240,102,114,.15); color: var(--color-error); cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: background 120ms;
}
.sx-tag__del:hover { background: rgba(240,102,114,.3); }
.sx-exclude__inp {
  flex: 1; min-width: 140px; height: 32px;
  background: none; border: none; outline: none;
  font-size: 13.5px; font-family: inherit; color: var(--text-primary); padding: 0 4px;
}
.sx-exclude__inp::placeholder { color: var(--text-muted); }

/* Suggest dropdown */
.sx-suggest {
  background: var(--bg-surface-2); border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);
  overflow: hidden; max-height: 240px; overflow-y: auto; margin-top: 4px;
}
.sx-suggest__row {
  width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  background: none; border: none; border-bottom: 1px solid var(--border);
  font-family: inherit; cursor: pointer; text-align: left; transition: background 80ms;
}
.sx-suggest__row:last-child { border-bottom: none; }
.sx-suggest__row:hover { background: rgba(52,168,83,.07); }
.sx-suggest__id { font-family: 'JetBrains Mono',monospace; font-size: 13px; font-weight: 800; color: var(--color-primary); flex-shrink: 0; }
.sx-suggest__title { font-size: 13px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── View buttons ─────────────────────────────────────────── */
.sx-view-btns { display: flex; flex-direction: column; gap: 8px; }
.sx-view-btn {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 18px; width: 100%;
  background: var(--bg-surface-1); border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  font-size: 14px; font-weight: 600; color: var(--text-primary);
  font-family: inherit; cursor: pointer; text-align: left;
  transition: background 130ms, border-color 130ms, transform 130ms;
}
.sx-view-btn:hover:not(:disabled) { background: var(--bg-surface-2); border-color: var(--border-strong); transform: translateX(2px); }
.sx-view-btn:disabled { opacity: .45; cursor: not-allowed; }
.sx-view-btn span { flex: 1; }
.sx-view-btn__arrow { color: var(--text-muted) !important; flex-shrink: 0; }

/* ── Form fields ──────────────────────────────────────────── */
.sx-field { display: flex; flex-direction: column; gap: 7px; }
.sx-field__row { display: flex; gap: 10px; }
.sx-lbl { font-size: 13px; font-weight: 700; color: var(--text-secondary); }
.sx-input {
   height: 58px; padding: 0 18px;
  background: var(--bg-surface-2); border: 1.5px solid var(--border-strong);
  border-radius: var(--radius-lg); color: var(--text-primary);
  font-size: 14px; font-family: inherit; outline: none;
  transition: border-color 200ms, box-shadow 200ms;
}
.sx-input::placeholder { color: var(--text-muted); }
.sx-input:focus { border-color: rgba(52,168,83,.5); box-shadow: 0 0 0 3px rgba(52,168,83,.1); }
.sx-hint { font-size: 12px; color: var(--text-muted); margin: 0; line-height: 1.4; }
.sx-hint kbd {
  font-family: 'JetBrains Mono',monospace; font-size: 10.5px;
  background: var(--bg-surface-3); border: 1px solid var(--border-strong);
  border-radius: 4px; padding: 1px 5px;
}

.sx-green-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 48px; padding: 0 18px; flex-shrink: 0;
  background: rgba(52,168,83,.15); border: 1.5px solid rgba(52,168,83,.3); border-radius: var(--radius-lg);
  color: #34a853; font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: background 120ms, transform 120ms;
}
.sx-green-btn:hover:not(:disabled) { background: rgba(52,168,83,.25); }
.sx-green-btn:disabled { opacity: .4; cursor: not-allowed; }
.sx-green-btn--sm { height: 28px; padding: 0 11px; font-size: 12px; border-radius: 99px; }

/* Steps list */
.sx-steps-list { display: flex; flex-direction: column; gap: 10px; }
.sx-step-item {
  display: flex; align-items: flex-start; gap: 12px; padding: 10px 14px;
  background: var(--bg-surface-2); border: 1px solid var(--border); border-radius: var(--radius-lg);
}
.sx-step-item__n {
  width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
  background: rgba(52,168,83,.12); border: 1px solid rgba(52,168,83,.25);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 800; color: #34a853; margin-top: 1px;
}
.sx-step-item span { font-size: 13.5px; color: var(--text-secondary); line-height: 1.5; }
.sx-step-item strong { color: var(--text-primary); font-weight: 700; }
.sx-step-item em { color: var(--color-primary); font-style: normal; font-weight: 600; }

/* Script box */
.sx-script-box { background: var(--bg-surface-2); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.sx-script-box__bar { display: flex; align-items: center; justify-content: space-between; padding: 9px 13px; border-bottom: 1px solid var(--border); }
.sx-ghost-btn {
  display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600;
  color: var(--text-secondary); background: none; border: none; cursor: pointer; font-family: inherit; padding: 0; transition: color 120ms;
}
.sx-ghost-btn:hover { color: var(--text-primary); }
.sx-code {
  margin: 0; padding: 14px; font-family: 'JetBrains Mono',monospace; font-size: 11px; line-height: 1.7;
  color: var(--text-secondary); background: var(--bg-surface); max-height: 260px; overflow-y: auto;
  white-space: pre-wrap; word-break: break-all;
}

/* Connected state */
.sx-connected {
  display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px;
  background: rgba(52,168,83,.07); border: 1px solid rgba(52,168,83,.2); border-radius: var(--radius-lg);
}
.sx-connected__title { font-size: 14px; font-weight: 700; color: #34a853; margin: 0 0 4px; }
.sx-connected__url { font-size: 11.5px; color: var(--text-muted); margin: 0; font-family: 'JetBrains Mono',monospace; word-break: break-all; }

/* ══ DIALOGS ═════════════════════════════════════════════════ */
.sx-dialog {
  background: var(--bg-surface-1); border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl); overflow: hidden;
  box-shadow: var(--shadow-xl);
}
.sx-dialog__hdr {
  display: flex; align-items: center; gap: 14px; padding: 20px 22px 18px;
  border-bottom: 1px solid var(--border); background: var(--bg-surface-2);
}
.sx-dialog__icon {
  width: 38px; height: 38px; flex-shrink: 0; border-radius: 11px;
  background: var(--bg-surface-3); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
}
.sx-dialog__title { font-size: 16px; font-weight: 800; color: var(--text-primary); margin: 0 0 3px; letter-spacing: -.01em; }
.sx-dialog__sub   { font-size: 12.5px; color: var(--text-muted); margin: 0; }
.sx-dialog__close {
  margin-left: auto; width: 32px; height: 32px; flex-shrink: 0;
  border: 1px solid var(--border); background: none; border-radius: 9px;
  color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background 120ms, color 120ms;
}
.sx-dialog__close:hover { background: var(--bg-surface-3); color: var(--text-primary); }

/* Columns list */
.sx-cols-list { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
.sx-col {
  display: flex; align-items: center; gap: 12px; padding: 13px 20px;
  border-bottom: 1px solid var(--border); border-right: 1px solid var(--border);
  transition: background 100ms;
}
.sx-col:hover { background: var(--bg-surface-2); }
.sx-col:nth-child(2n) { border-right: none; }
.sx-col:nth-last-child(-n+2) { border-bottom: none; }
.sx-col__letter {
  width: 28px; height: 28px; flex-shrink: 0; border-radius: 8px;
  background: rgba(52,168,83,.12); border: 1px solid rgba(52,168,83,.22);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800; color: #34a853; font-family: 'JetBrains Mono',monospace;
}
.sx-col__name { font-size: 13.5px; color: var(--text-primary); font-weight: 500; }

/* Preview table */
.sx-tbl-wrap { overflow-x: auto; max-height: 60vh; overflow-y: auto; }
.sx-tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 700px; }
.sx-tbl thead { position: sticky; top: 0; z-index: 1; }
.sx-tbl thead tr { background: var(--bg-surface-2); border-bottom: 2px solid var(--border); }
.sx-tbl thead th {
  padding: 11px 13px; text-align: left;
  font-size: 10.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .06em; color: var(--text-muted); white-space: nowrap;
}
.sx-tbl tbody tr { border-bottom: 1px solid var(--border); transition: background 80ms; }
.sx-tbl tbody tr:last-child { border-bottom: none; }
.sx-tbl tbody tr:hover td { background: rgba(52,168,83,.03); }
.sx-tbl td { padding: 10px 13px; color: var(--text-secondary); vertical-align: middle; }
.sx-tbl td.mono { font-family: 'JetBrains Mono',monospace; font-size: 11.5px; color: var(--text-primary); white-space: nowrap; }
.sx-tbl td.trunc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sx-pill { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 99px; font-size: 11px; font-weight: 600; }
.sx-pill--done { background: rgba(52,168,83,.1); color: #34a853; border: 1px solid rgba(52,168,83,.2); }
.sx-pill--wip  { background: var(--color-primary-dim); color: var(--color-primary); border: 1px solid rgba(79,142,247,.2); }

.sx-cf--y { font-weight: 800; color: var(--color-warning); }
.sx-cf--n { color: var(--text-muted); }

/* Empty */
.sx-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 24px; text-align: center; }
.sx-empty p { font-size: 14px; color: var(--text-secondary); margin: 0; }

/* Transitions */
.sx-fade-enter-active, .sx-fade-leave-active { transition: opacity 200ms; }
.sx-fade-enter-from, .sx-fade-leave-to       { opacity: 0; }
.sx-drop-enter-active { transition: all 140ms var(--ease-out); }
.sx-drop-leave-active { transition: all 100ms var(--ease-in); }
.sx-drop-enter-from, .sx-drop-leave-to { opacity: 0; transform: translateY(-4px); }

/* ── Responsive ─────────────────────────────────────────────── */
@media (max-width: 1060px) {
  .sx-body { grid-template-columns: 1fr; }
  .sx-left { position: static; }
}
@media (max-width: 700px) {
  .sx-hero { flex-direction: column; gap: 16px; }
  .sx-hero__right { width: 100%; }
  .sx-kpis { flex: 1; }
  .sx-sync-btn { flex: 1; justify-content: center; }
}
</style>
