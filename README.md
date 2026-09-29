# Gitea Time Tracker

A modern, self-hosted dashboard for tracking time spent on Gitea issues. Connects directly to your Gitea instance via the API — no extra services required.

---

## Features

- **Dashboard** — Today / This Week / This Month KPI cards with animated progress bars and a week mini-bar chart. Includes a bar chart (daily / weekly / monthly), weekly pace gauge, recent activity, top repositories, and a contribution heatmap.
- **Work Details** — Drill into any date or date range. See a ticket-by-ticket breakdown with expandable time entry timelines and CSV export.
- **Sheets Export** — Sync work entries directly to a Google Sheet via an Apps Script proxy. Supports smart append (no duplicates), ticket exclusion with autocomplete, and a live data preview.
- **Running timer** — When a Gitea "Start timer" is active, the current ticket and elapsed time appear in the top bar.
- **Dark / Light theme** — System preference detected automatically; toggle any time from the top bar.
- **No external auth** — Uses your Gitea token or basic credentials. Nothing leaves your network except Google Sheets sync (optional).

---

## Tech Stack

| Layer | Library |
|---|---|
| UI framework | Vue 3 + Vite |
| Component library | Vuetify 3 |
| State management | Pinia |
| HTTP client | Axios |
| Excel export | SheetJS (xlsx) |
| Routing | Vue Router 4 |

---

## Requirements

- Node.js 18 or later
- A running Gitea instance (v1.19+ recommended)
- A Gitea personal access token with **issue** and **user** read scopes

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/mobindaz/gitteatracker
cd gitea-time-tracker
npm install
```

### 2. Run in development

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

### 3. Build for production

```bash
npm run build
```

The output is in `dist/`. Serve it with any static file server (nginx, Caddy, `npx serve dist`, etc.).

---

## First login

1. Open the app in your browser.
2. Enter your **Gitea server URL** (e.g. `http://192.168.1.10:3000`).
3. Enter your **username** and a **personal access token** (Settings → Applications → Generate Token in Gitea).
4. Click **Sign in**. The app fetches your time entries and renders the dashboard.

> **CORS note** — If your Gitea server blocks cross-origin requests, add this to `app.ini` and restart Gitea:
> ```ini
> [cors]
> ENABLED   = true
> ALLOW_DOMAIN = *
> ```

---

## Google Sheets Export (optional)

The Sheets Export page syncs your work entries to a Google Sheet without any OAuth setup. It uses a tiny Google Apps Script as a proxy.

### One-time setup (~3 minutes)

1. Open your Google Sheet → **Extensions → Apps Script**.
2. Delete any existing code, paste the script from the **Apps Script Setup** card in the app, and save (`Ctrl+S`).
3. Click **Deploy → New deployment** → Type: **Web app**.
4. Set **Execute as: Me** and **Who has access: Anyone**, then click **Deploy**.
5. Copy the **Web App URL** and paste it into the app — saved permanently.

### Syncing

- Select a date or date range.
- Optionally exclude specific tickets using the autocomplete exclude field.
- Click **Sync N rows**.

New rows are inserted at the top of the sheet (newest first). Duplicates are detected automatically and skipped. A thick border separates each sync batch visually.

### Columns exported

| Col | Field |
|---|---|
| A | Task ID |
| B | Task Description |
| C | Date (DD/MM/YYYY) |
| D | Programmer |
| E | Status (In Progress / Completed) |
| F | Estimated Hrs |
| G | Actual Hrs |
| H | Estimated Start Date |
| I | Estimated End Date |
| J | Actual Start Date |
| K | Actual End Date |
| L | Carry Forwarded (Y/N) |

---

## Settings

Click your avatar in the top bar → **Settings** to adjust:

| Setting | Default | Description |
|---|---|---|
| Target hours / day | 8 | Used for progress bars and balance calculations |
| Work days / week | 5 | Used for weekly and monthly targets |
| History range (days) | 90 | How far back to fetch time entries |

Settings are saved to `localStorage` and persist across page reloads.

---

## Project structure

```
src/
├── api/
│   └── gitea.ts          # All Gitea API calls (times, stopwatches, heatmap)
├── assets/
│   └── main.css          # Global design tokens and utility classes
├── components/
│   ├── BarChart.vue
│   ├── ContributionHeatmap.vue
│   ├── RecentActivity.vue
│   ├── StatCard.vue
│   ├── TodayStatus.vue
│   ├── TopRepos.vue
│   └── WeeklyPaceGauge.vue
├── composables/
│   ├── useAnimatedNumber.ts
│   └── useParticles.ts
├── plugins/
│   └── vuetify.ts
├── router/
│   └── index.ts
├── stores/
│   ├── auth.ts           # Credentials, login/logout, axios client
│   └── timeTracking.ts   # All time entry data, getters, stopwatch polling
├── types/
│   └── gitea.ts          # TypeScript interfaces for the Gitea API
├── utils/
│   ├── dateUtils.ts      # Date formatting and grouping helpers
│   ├── excelExport.ts    # XLSX workbook generation
│   └── sheetsProxy.ts    # Google Sheets sync via Apps Script
└── views/
    ├── DashboardView.vue
    ├── LoginView.vue
    ├── SheetsExportView.vue
    └── WorkDetailsView.vue
```

---

## License

MIT
