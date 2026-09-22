#!/usr/bin/env python3
"""Turn data/books.json into SQL for D1, one INSERT per book (ord = position)."""
import json
import sys

src = sys.argv[1] if len(sys.argv) > 1 else "/root/projects/command-center/data/books.json"
books = json.load(open(src))
out = []
for i, b in enumerate(books, start=1):
    t = b["t"].replace("'", "''")
    a = b["a"].replace("'", "''")
    l = b["l"].replace("'", "''")
    out.append(
        f"INSERT INTO books (ord, title, author, lesson) VALUES ({i}, '{t}', '{a}', '{l}') "
        f"ON CONFLICT(ord) DO UPDATE SET title=excluded.title, author=excluded.author, lesson=excluded.lesson;"
    )
print("\n".join(out))
print(f"-- {len(books)} books", file=sys.stderr)
