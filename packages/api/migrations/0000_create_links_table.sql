-- Migration number: 0000 	 2026-01-31T12:00:00.000Z
CREATE TABLE links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  status TEXT CHECK(status IN ('approved', 'pending')) DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
