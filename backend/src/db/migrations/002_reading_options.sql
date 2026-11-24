-- Opções de leitura escolhidas por quem envia (autoridade exclusiva do servidor).
ALTER TABLE letters ADD COLUMN fade_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE letters ADD COLUMN read_time_limit_seconds INTEGER;
ALTER TABLE letters ADD COLUMN seal_asset_id TEXT;

-- Assets binários vivem no mesmo SQLite e são apagados junto com o plaintext.
CREATE TABLE IF NOT EXISTS letter_assets (
  id TEXT PRIMARY KEY,
  letter_id TEXT REFERENCES letters(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'seal')),
  mime TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  -- Teto por kind (foto 2 MiB / selo 16 KiB) validado no serviço, não no CHECK.
  byte_size INTEGER NOT NULL,
  data BLOB NOT NULL,
  upload_token_hash TEXT UNIQUE,
  attached INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_letter_assets_letter_kind ON letter_assets(letter_id, kind);
CREATE INDEX IF NOT EXISTS idx_letter_assets_orphan ON letter_assets(attached, created_at);
