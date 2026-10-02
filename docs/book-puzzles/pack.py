#!/usr/bin/env python3
"""Package externally authored JSON into the book .db3 interchange format (no extraction)."""
import argparse
import json
from pathlib import Path
import sqlite3

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("json_file", type=Path)
parser.add_argument("database", type=Path)
args = parser.parse_args()
if args.database.exists():
    parser.error("Output already exists; use a new filename.")
data = json.loads(args.json_file.read_text(encoding="utf-8"))
if data.get("schemaVersion") != 1:
    parser.error("Unsupported schemaVersion.")
book = data["book"]
with sqlite3.connect(args.database) as conn:
    conn.executescript(Path(__file__).with_name("schema.sql").read_text())
    conn.execute("INSERT INTO book_metadata VALUES (1, 1, ?, ?, ?)", (book["id"], book["title"], book["edition"]))
    conn.executemany("INSERT INTO book_problems VALUES (?, ?, ?)", [(p["id"], p["order"], json.dumps(p, ensure_ascii=False)) for p in data["problems"]])
print(args.database)
