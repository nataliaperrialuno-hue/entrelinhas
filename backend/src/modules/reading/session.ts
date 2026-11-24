import type { Db } from '../../db/client';
import type { SessionState } from '../letters/state';

export interface SessionRow {
  id: string;
  letter_id: string;
  token_hash: string;
  state: SessionState;
  epoch: number;
  last_progress: number;
  last_seen_at: number;
  grace_until: number;
  created_at: number;
  completed_at: number | null;
}

export interface NewSession {
  id: string;
  letterId: string;
  tokenHash: string;
  epoch: number;
  lastProgress: number;
  now: number;
  graceUntil: number;
}

type SqlValue = string | number | null;

function one<T>(db: Db, sql: string, ...params: SqlValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

function changes(db: Db, sql: string, ...params: SqlValue[]): number {
  return Number(db.prepare(sql).run(...params).changes);
}

const SESSION_COLUMNS = `
  id, letter_id, token_hash, state, epoch, last_progress,
  last_seen_at, grace_until, created_at, completed_at
`;

export function insertSession(db: Db, input: NewSession): void {
  db.prepare(`
    INSERT INTO sessions (
      id, letter_id, token_hash, state, epoch, last_progress,
      last_seen_at, grace_until, created_at
    ) VALUES (?, ?, ?, 'opening', ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.letterId,
    input.tokenHash,
    input.epoch,
    input.lastProgress,
    input.now,
    input.graceUntil,
    input.now,
  );
}

export function findSessionById(db: Db, id: string): SessionRow | undefined {
  return one<SessionRow>(db, `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`, id);
}

export function invalidateSession(db: Db, id: string): void {
  changes(db, `UPDATE sessions SET state = 'invalidated' WHERE id = ?`, id);
}

export function openSession(db: Db, id: string, now: number): boolean {
  return changes(
    db,
    `UPDATE sessions
        SET state = 'reading', epoch = epoch + 1, last_seen_at = ?
      WHERE id = ? AND state = 'opening'`,
    now,
    id,
  ) === 1;
}

export function completeSession(db: Db, id: string, now: number): boolean {
  return changes(
    db,
    `UPDATE sessions
        SET state = 'completed', completed_at = ?
      WHERE id = ? AND state IN ('opening', 'reading')`,
    now,
    id,
  ) === 1;
}

/** Avanço monotônico: só atualiza quando o novo valor é maior que o armazenado. */
export function advanceProgress(db: Db, id: string, progress: number, now: number): boolean {
  return changes(
    db,
    `UPDATE sessions
        SET last_progress = ?, last_seen_at = ?
      WHERE id = ?
        AND state IN ('opening', 'reading')
        AND last_progress < ?`,
    progress,
    now,
    id,
    progress,
  ) === 1;
}

/** Mantém o heartbeat vivo quando o leitor envia progresso repetido. */
export function refreshHeartbeat(db: Db, id: string, now: number): void {
  changes(
    db,
    `UPDATE sessions
        SET last_seen_at = ?
      WHERE id = ? AND state IN ('opening', 'reading')`,
    now,
    id,
  );
}

export function expireSessions(db: Db, now: number, staleBefore: number): number {
  return changes(
    db,
    `UPDATE sessions
        SET state = 'expired'
      WHERE state IN ('opening', 'reading')
        AND last_seen_at < ?
        AND grace_until < ?`,
    staleBefore,
    now,
  );
}
