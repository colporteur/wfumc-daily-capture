# WFUMC Daily Capture

A triage workflow for daily audio transcripts (Plaud Note, voice memos,
etc.). Paste or upload a transcript, Claude segments it into
pastorally-meaningful chunks, and the pastor routes each chunk to one
or more destinations:

- **Pastoral interaction** — saved to a person's record in the Pastoral
  Records app
- **Pastoral note** — saved to a person's record in the Pastoral
  Records app (shorter than an interaction; e.g., "remember Mrs.
  Johnson likes lemon poppyseed muffins")
- **Sermon resource** — saved to the Sermons app as a quote /
  illustration / observation

Same Supabase project as the rest of the WFUMC suite — auth and RLS
are unified across all apps.

## Stack

React + Vite + Tailwind + Supabase + Claude via the shared
`claude-proxy` Edge Function. PWA-enabled. Deploys to GitHub Pages via
Actions on push to `main`.

## Local development

```bash
npm install
cp .env.example .env.local
# Fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (same as other WFUMC apps)
npm run dev
```

Default port: **5178**.

## Database schema

Migration `0055_daily_capture.sql` lives in the WFUMC Bulletin App's
`supabase/migrations/` directory (all apps share one Supabase project,
so all migrations live there). Apply it via Supabase SQL Editor before
running this app for the first time.

Two tables:

- `daily_captures` — one row per uploaded transcript
- `daily_capture_segments` — one row per Claude-detected segment

Both are owner-scoped via RLS.

## Deploy

Push to `main`. GitHub Actions builds and pushes to GitHub Pages.
Repo secrets needed:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

(Same values as the other WFUMC repos.)
