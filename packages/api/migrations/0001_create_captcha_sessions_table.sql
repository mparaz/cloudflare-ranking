CREATE TABLE IF NOT EXISTS captcha_sessions (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  ua_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_captcha_sessions_expires_at ON captcha_sessions (expires_at);
