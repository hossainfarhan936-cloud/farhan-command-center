-- Command Center D1 schema
CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- daily rotation content: the book list is read in order, one per day
CREATE TABLE IF NOT EXISTS books (
  ord    INTEGER PRIMARY KEY,   -- 1-based position in the rotation
  title  TEXT NOT NULL,
  author TEXT NOT NULL,
  lesson TEXT NOT NULL
);

-- one row per day: what the Today card shows. Written by the daily job.
CREATE TABLE IF NOT EXISTS daily (
  day          TEXT PRIMARY KEY,   -- YYYY-MM-DD (Asia/Dhaka)
  book_ord     INTEGER,
  book_title   TEXT,
  book_author  TEXT,
  book_lesson  TEXT,
  weird        TEXT,
  source       TEXT,               -- 'seed' | 'cron' | 'manual'
  created_at   TEXT NOT NULL
);