CREATE TABLE IF NOT EXISTS letters (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  sender_name TEXT,
  recipient_name TEXT,
  signature TEXT,
  sender_anonymous INTEGER NOT NULL DEFAULT 0,
  theme_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'unopened' CHECK (state IN ('unopened','opening','reading','completed','expired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  opened_at INTEGER,
  completed_at INTEGER,
  current_session_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_letters_state_expires ON letters(state, expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  letter_id TEXT NOT NULL REFERENCES letters(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'opening' CHECK (state IN ('opening','reading','completed','expired','invalidated')),
  epoch INTEGER NOT NULL DEFAULT 0,
  last_progress REAL NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL,
  grace_until INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_letter ON sessions(letter_id);
CREATE INDEX IF NOT EXISTS idx_sessions_state_seen ON sessions(state, last_seen_at);
