# Farhan's Command Center

Personal dashboard: Cloudflare Pages frontend + Pages Functions API + D1 database.
Data is stored on the server, so the same dashboard opens on every device behind a passcode.

**Live:** https://farhan-command-center.pages.dev

## Sections
- **Today** — date, tasks due/overdue, book lesson of the day, weird knowledge, snapshot, leads to move
- **To-do** — tasks with due dates, completed list
- **Content** — content calendar: Idea → Recorded → Editing → Ready → Published
- **Leads** — pipeline: New → Prospect → Interested → Proposal Sent → Nurture → Client / Lost, with "→ client" promotion
- **Clients** — client cards with services, value, notes, active/expired
- **Memory Vault** — searchable journal
- **Learn** — books with key lessons + weird-knowledge facts, one of each per day
- **Ideas** — idea inbox, send an idea to the content calendar or research queue
- **Research** — queue topics; each gets a ready-to-send agent prompt
- **Team** — contacts

The top search box searches every section. ⚙ holds export/import, sync now, rename, change passcode,
sign out and erase.

## Architecture
- `index.html`, `styles.css`, `app.js` — frontend, no build step
- `functions/api/[[path]].js` — same-origin API at `/api/*`, so no CORS and cookies just work
- `schema.sql` — D1 tables: `app_state` (single JSON document) + `settings` (passcode hash, session secret)
- `scripts/seed-passcode.js` — prints the SQL that seeds a passcode hash into D1

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | liveness |
| `/api/session` | GET | `{ authenticated, needsSetup }` |
| `/api/login` | POST | `{ passcode }` → sets the session cookie |
| `/api/logout` | POST | clears the cookie |
| `/api/state` | GET / PUT | read / save the dashboard document |
| `/api/passcode` | POST | `{ next }` → rotates the passcode |

**Auth:** the passcode is hashed with PBKDF2-SHA256 (100k iterations, random salt) in D1; the session is
an HMAC-SHA256 signed cookie — HttpOnly, Secure, SameSite=Lax, 30 days. Failed logins are delayed 600 ms.
The session secret is generated on first use and kept in `settings`.

**Offline safety:** every change writes to localStorage immediately, then PUTs to the server (debounced
500 ms). If the API is unreachable the dashboard keeps working locally and the top bar shows `offline`.
Returning to the tab pulls changes made on another device.

## Local development
```bash
python3 -m http.server 8000     # static only — /api needs wrangler
npx wrangler pages dev .        # full stack with a local D1
```

## Deploy
```bash
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
npx wrangler pages deploy . --project-name farhan-command-center --branch main
```

D1 database `command-center` is bound as `DB` on the Pages project for both production and preview.

## Not in git
The dashboard passcode is never committed — it is seeded straight into D1 and stored outside the repo.

## Motion
3D and UI animation live in `scene.js` (Three.js scene, CDN module) and the `motion layer` block at the
end of `styles.css`:
- login: floating low-poly scene with pointer parallax, spinning CSS 3D logo cube, card entrance / shake on
  a failed login / fly-out on success, pulsing badge dot
- dashboard: staggered card entrance on a real view change only (tab or search), pointer-driven 3D card tilt,
  animated strike-through and pop on ticking a to-do, rows animate out before a delete commits, pulsing sync badge
- everything is disabled by one `prefers-reduced-motion` block, and the 3D scene degrades silently if the CDN
  or WebGL is unavailable — the login never depends on it

## Next (phase 3, planned)
AI-filled panels: daily video/business ideas, newsletter digest from the agent mailbox, and research
answers written into the Research tab instead of just queueing prompts.