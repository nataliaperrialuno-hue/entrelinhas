import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type Db = DatabaseSync;

const MIGRATION_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations',
  '001_init.sql',
);

export function createDb(filename = ':memory:'): Db {
  const db = new DatabaseSync(filename);

  try {
    db.exec('PRAGMA journal_mode = WAL;');
  } catch {
    // Bancos em memória não suportam WAL; o modo padrão é suficiente.
  }

  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(MIGRATION_PATH, 'utf8'));

  return db;
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
