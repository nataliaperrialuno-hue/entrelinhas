import type { Db } from '../../db/client';
import type { LetterState } from './state';
import type { LetterDraft } from './validation';

export interface LetterRow {
  id: string;
  token_hash: string;
  title: string;
  message: string;
  sender_name: string | null;
  recipient_name: string | null;
  signature: string | null;
  sender_anonymous: number;
  theme_json: string;
  state: LetterState;
  created_at: number;
  expires_at: number;
  opened_at: number | null;
  completed_at: number | null;
  current_session_id: string | null;
}

export interface NewLetter {
  id: string;
  tokenHash: string;
  draft: LetterDraft;
  createdAt: number;
  expiresAt: number;
}

type SqlValue = string | number | null;

function one<T>(db: Db, sql: string, ...params: SqlValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

function changes(db: Db, sql: string, ...params: SqlValue[]): number {
  return Number(db.prepare(sql).run(...params).changes);
}

const LETTER_COLUMNS = `
  id, token_hash, title, message, sender_name, recipient_name, signature,
  sender_anonymous, theme_json, state, created_at, expires_at, opened_at,
  completed_at, current_session_id
`;

export function insertLetter(db: Db, input: NewLetter): void {
  db.prepare(`
    INSERT INTO letters (
      id, token_hash, title, message, sender_name, recipient_name,
      signature, sender_anonymous, theme_json, state, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unopened', ?, ?)
  `).run(
    input.id,
    input.tokenHash,
    input.draft.title,
    input.draft.message,
    input.draft.senderAnonymous ? null : input.draft.senderName,
    input.draft.recipientName,
    input.draft.signature,
    input.draft.senderAnonymous ? 1 : 0,
    JSON.stringify(input.draft.theme),
    input.createdAt,
    input.expiresAt,
  );
}

export function findLetterById(db: Db, id: string): LetterRow | undefined {
  return one<LetterRow>(db, `SELECT ${LETTER_COLUMNS} FROM letters WHERE id = ?`, id);
}

export function findLetterByTokenHash(db: Db, tokenHash: string): LetterRow | undefined {
  return one<LetterRow>(
    db,
    `SELECT ${LETTER_COLUMNS} FROM letters WHERE token_hash = ?`,
    tokenHash,
  );
}

/** CAS: apenas a primeira requisição consegue transitar de unopened para opening. */
export function claimLetter(
  db: Db,
  params: { letterId: string; sessionId: string; now: number },
): boolean {
  return changes(
    db,
    `UPDATE letters
        SET state = 'opening', opened_at = ?, current_session_id = ?
      WHERE id = ? AND state = 'unopened' AND expires_at > ?`,
    params.now,
    params.sessionId,
    params.letterId,
    params.now,
  ) === 1;
}

export function markLetterReading(db: Db, letterId: string, sessionId: string): void {
  changes(
    db,
    `UPDATE letters
        SET state = 'reading'
      WHERE id = ? AND current_session_id = ? AND state = 'opening'`,
    letterId,
    sessionId,
  );
}

/** Conclui a carta e apaga o plaintext em uma única instrução atômica. */
export function completeLetter(
  db: Db,
  params: { letterId: string; sessionId: string; now: number },
): boolean {
  return changes(
    db,
    `UPDATE letters
        SET state = 'completed',
            completed_at = ?,
            title = '',
            message = '',
            signature = NULL,
            sender_name = NULL,
            recipient_name = NULL
      WHERE id = ?
        AND current_session_id = ?
        AND state <> 'completed'`,
    params.now,
    params.letterId,
    params.sessionId,
  ) === 1;
}

export function expireUnopenedLetters(db: Db, now: number): number {
  return changes(
    db,
    `UPDATE letters
        SET state = 'expired',
            title = '',
            message = '',
            signature = NULL,
            sender_name = NULL,
            recipient_name = NULL
      WHERE state = 'unopened' AND expires_at <= ?`,
    now,
  );
}

/** Cartas órfãs cuja sessão atual expirou e que não têm sessão ativa. */
export function expireStaleReadingLetters(db: Db, now: number): number {
  return changes(
    db,
    `UPDATE letters
        SET state = 'expired',
            title = '',
            message = '',
            signature = NULL,
            sender_name = NULL,
            recipient_name = NULL
      WHERE state IN ('opening', 'reading')
        AND current_session_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM sessions s
           WHERE s.id = letters.current_session_id
             AND s.state = 'expired'
        )
        AND NOT EXISTS (
          SELECT 1 FROM sessions s
           WHERE s.letter_id = letters.id
             AND s.state IN ('opening', 'reading')
             AND s.grace_until >= ?
        )`,
    now,
  );
}
