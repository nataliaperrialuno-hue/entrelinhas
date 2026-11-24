import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';

const MIGRATION_001 = fileURLToPath(
  new URL('../src/db/migrations/001_init.sql', import.meta.url),
);

let directory: string | undefined;

afterEach(() => {
  if (directory !== undefined) {
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

describe('migrações incrementais', () => {
  it('evolui um banco legado com user_version 0 e tabelas de 001', () => {
    directory = mkdtempSync(join(tmpdir(), 'entrelinhas-migration-'));
    const filename = join(directory, 'legacy.db');

    const legacy = new DatabaseSync(filename);
    legacy.exec(readFileSync(MIGRATION_001, 'utf8'));
    legacy.close();

    const db: Db = createDb(filename);
    const columns = db.prepare('PRAGMA table_info(letters)').all() as Array<{ name: string }>;
    const names = columns.map((column) => column.name);

    expect(names).toContain('fade_enabled');
    expect(names).toContain('read_time_limit_seconds');
    expect(names).toContain('seal_asset_id');
    expect(
      db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'letter_assets'",
      ).get(),
    ).toBeDefined();
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(2);

    // O esquema não impõe teto de 256 KiB: o limite por kind vive no serviço.
    db.prepare(`
      INSERT INTO letter_assets (
        id, kind, mime, width, height, byte_size, data, attached, created_at
      ) VALUES (?, 'photo', 'image/png', 1600, 1600, ?, ?, 0, ?)
    `).run('photo-2mib', 2 * 1024 * 1024, Buffer.alloc(8), Date.now());
    const stored = db.prepare('SELECT byte_size FROM letter_assets WHERE id = ?')
      .get('photo-2mib') as { byte_size: number };
    expect(stored.byte_size).toBe(2 * 1024 * 1024);

    db.close();
  });

  it('é idempotente ao abrir o mesmo arquivo novamente', () => {
    directory = mkdtempSync(join(tmpdir(), 'entrelinhas-migration-'));
    const filename = join(directory, 'current.db');

    const first = createDb(filename);
    first.close();
    const second = createDb(filename);

    expect(
      (second.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(2);
    second.close();
  });
});
