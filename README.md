# Farhan's Command Center

Personal dashboard. Frontend only for now: a single static app (no build step) deployed to
Cloudflare Pages, with data stored in the browser's localStorage.

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
- **Research** — queue topics; each gets a ready-to-send agent prompt (AI wiring in phase 2)
- **Team** — contacts

Search box at the top searches everything. ⚙ opens export/import/erase.

## Run locally
Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
```

## Deploy
```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
  npx wrangler pages deploy . --project-name farhan-command-center --branch main
```

## Phase 2 (planned)
Data currently lives per-browser. Next: a Cloudflare Worker API + D1 database so the same
data appears on every device, with login protecting it, plus AI-filled panels
(daily ideas, newsletter insights, research answers).