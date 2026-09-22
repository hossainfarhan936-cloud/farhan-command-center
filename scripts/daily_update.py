#!/usr/bin/env python3
"""Daily content job for the Command Center.

Writes ONE row into the D1 `daily` table for today (Asia/Dhaka):
  - book lesson: the next book in `books`, read in order (ord = 1, 2, 3 … wraps at the end)
  - weird knowledge: a freshly generated true-but-strange fact, avoiding recent repeats

Idempotent: if today's row already exists it does nothing (safe to run twice).
Usage:
  python3 scripts/daily_update.py            # write today's row
  python3 scripts/daily_update.py --dry-run  # show what it would write, touch nothing
  python3 scripts/daily_update.py --force    # overwrite today's row
"""
import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

DB = "command-center"
REPO = "/root/projects/command-center"
# Which calendar day the content belongs to. Change this single line to move zones,
# e.g. America/Chicago, America/Denver, America/Los_Angeles.
TIMEZONE = "America/New_York"
DRY = "--dry-run" in sys.argv
FORCE = "--force" in sys.argv


def wrangler(sql, json_out=False):
    """Run a D1 statement remotely; return parsed result rows when json_out."""
    env = dict(os.environ)
    env["CLOUDFLARE_API_TOKEN"] = open("/root/.secrets/cloudflare_token").read().strip()
    env["CLOUDFLARE_ACCOUNT_ID"] = "0e1e7a197b4dabcda25e62d78c5b62e4"
    cmd = ["npx", "--yes", "wrangler@4", "d1", "execute", DB, "--remote", "--command", sql, "-y"]
    if json_out:
        cmd.append("--json")
    out = subprocess.run(cmd, cwd=REPO, env=env, capture_output=True, text=True, timeout=180)
    if json_out:
        try:
            start = out.stdout.index("[")
            data = json.loads(out.stdout[start:])
            return (data[0].get("results") or []) if data else []
        except Exception:
            print("wrangler parse failed:", out.stdout[-400:], out.stderr[-400:], file=sys.stderr)
            return []
    if out.returncode != 0:
        print("wrangler failed:", out.stderr[-500:], file=sys.stderr)
    return []


def esc(v):
    return str(v).replace("'", "''")


def openrouter_fact(recent):
    key = None
    for line in open("/root/.hermes/.env"):
        if line.startswith("OPENROUTER_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"')
            break
    if not key:
        return None
    avoid = "; ".join(recent) if recent else "(none)"
    prompt = (
        "Give ONE surprising but TRUE fact about science, nature, history, money or the human body. "
        "Rules: max 30 words, no preamble, no numbering, plain sentence, must be verifiable and not a myth. "
        f"Do not reuse anything from this list: {avoid}"
    )
    payload = {
        "model": "google/gemini-2.5-flash",
        "temperature": 1.0,
        "messages": [{"role": "user", "content": prompt}],
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        text = json.loads(r.read().decode())["choices"][0]["message"]["content"].strip()
    return text.split("\n")[0].strip().strip('"')


def main():
    today = datetime.now(ZoneInfo(TIMEZONE)).strftime("%Y-%m-%d")

    existing = wrangler(f"SELECT day, source FROM daily WHERE day = '{today}'", json_out=True)
    if existing and not FORCE and not DRY:
        print(f"{today}: already written by {existing[0].get('source')} — nothing to do")
        return

    cursor_rows = wrangler("SELECT value FROM settings WHERE key = 'book_cursor'", json_out=True)
    cursor = int(cursor_rows[0]["value"]) if cursor_rows else 1

    total_rows = wrangler("SELECT COUNT(*) AS n FROM books", json_out=True)
    total = int(total_rows[0]["n"]) if total_rows else 0
    if not total:
        print("no books in the database — aborting", file=sys.stderr)
        sys.exit(1)
    if cursor < 1 or cursor > total:
        cursor = 1

    book_rows = wrangler(f"SELECT ord, title, author, lesson FROM books WHERE ord = {cursor}", json_out=True)
    if not book_rows:
        print(f"book #{cursor} missing", file=sys.stderr)
        sys.exit(1)
    book = book_rows[0]

    recent_rows = wrangler("SELECT weird FROM daily WHERE weird IS NOT NULL ORDER BY day DESC LIMIT 30", json_out=True)
    recent = [r["weird"] for r in recent_rows]
    try:
        fact = openrouter_fact(recent)
    except Exception as exc:
        fact = None
        print("fact generation failed:", exc, file=sys.stderr)

    print(f"day      : {today}")
    print(f"book #{cursor}/{total}: {book['title']} — {book['author']}")
    print(f"lesson   : {book['lesson']}")
    print(f"weird    : {fact or '(generation failed — keeping previous row untouched)'}")

    if DRY:
        print("\n[dry run] nothing written")
        return
    if not fact:
        print("refusing to write a row without a fact", file=sys.stderr)
        sys.exit(1)

    now = datetime.now(timezone.utc).isoformat()
    sql = (
        "INSERT INTO daily (day, book_ord, book_title, book_author, book_lesson, weird, source, created_at) VALUES "
        f"('{today}', {book['ord']}, '{esc(book['title'])}', '{esc(book['author'])}', "
        f"'{esc(book['lesson'])}', '{esc(fact)}', 'cron', '{now}') "
        "ON CONFLICT(day) DO UPDATE SET book_ord=excluded.book_ord, book_title=excluded.book_title, "
        "book_author=excluded.book_author, book_lesson=excluded.book_lesson, weird=excluded.weird, "
        "source=excluded.source, created_at=excluded.created_at;"
    )
    wrangler(sql)

    next_cursor = cursor + 1 if cursor < total else 1
    wrangler(
        "INSERT INTO settings (key, value) VALUES ('book_cursor', "
        f"'{next_cursor}') ON CONFLICT(key) DO UPDATE SET value = excluded.value;"
    )

    check = wrangler(f"SELECT day, book_title, weird FROM daily WHERE day = '{today}'", json_out=True)
    if check:
        print(f"\nwritten for {check[0]['day']}: book #{cursor} = {check[0]['book_title']}")
        print(f"next book will be #{next_cursor}")
    else:
        print("write verification failed", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()