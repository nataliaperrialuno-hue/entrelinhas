import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type Db = DatabaseSync;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

interface Migration {
  version: number;
  filename: string;
}

function migrationFiles(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((filename) => /^\d+_[\w-]+\.sql$/.test(filename))
    .map((filename) => ({
      filename,
      version: Number.parseInt(filename.slice(0, filename.indexOf('_')), 10),
    }))
    .filter((migration) => Number.isInteger(migration.version))
    .sort((left, right) => left.version - right.version);
}

function currentVersion(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

function columnExists(db: Db, table: string, column: string): boolean {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return info.some((entry) => entry.name === column);
}

/**
 * Os arquivos de migração são idempotentes: 001 usa IF NOT EXISTS e os ADD COLUMN
 * já aplicados são ignorados (banco legado com user_version 0 pode tê-los).
 */
function migrationStatements(db: Db, filename: string): string[] {
  const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');

  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .filter((statement) => {
      const alter = /^ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i.exec(statement);
      if (alter === null) {
        return true;
      }

      const table = alter[1];
      const column = alter[2];
      return !columnExists(db, table, column);
    });
}

function applyMigrations(db: Db): void {
  for (const migration of migrationFiles()) {
    if (currentVersion(db) >= migration.version) {
      continue;
    }

    immediate(db, () => {
      for (const statement of migrationStatements(db, migration.filename)) {
        db.exec(statement);
      }
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
}

export function createDb(filename = ':memory:'): Db {
  const db = new DatabaseSync(filename);

  try {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      // Bancos em memória não suportam WAL; o modo padrão é suficiente.
    }

    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    applyMigrations(db);

    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function immediate<T>(db: Db, fn: () => T): T {
  let inTransaction = false;

  try {
    try {
      db.exec('BEGIN IMMEDIATE');
      inTransaction = true;
    } catch {
      // Já existe transação aberta pelo chamador: executar fn sem aninhar.
      return fn();
    }

    const result = fn();
    db.exec('COMMIT');
    inTransaction = false;
    return result;
  } catch (error) {
    if (inTransaction) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Preservar o erro original da operação que falhou.
      }
    }
    throw error;
  }
}
