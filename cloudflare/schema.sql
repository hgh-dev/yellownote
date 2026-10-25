CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS exchanges (
  code TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
