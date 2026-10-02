-- Book puzzle interchange format v1. Source databases never contain user progress.
PRAGMA user_version = 1;
CREATE TABLE book_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  edition TEXT NOT NULL
);
CREATE TABLE book_problems (
  problem_id TEXT PRIMARY KEY NOT NULL,
  sort_order INTEGER UNIQUE NOT NULL CHECK (sort_order > 0),
  payload TEXT NOT NULL -- UTF-8 JSON problem object from schema.json
);
