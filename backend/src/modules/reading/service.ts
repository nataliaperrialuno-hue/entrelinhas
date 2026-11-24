import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config';
import { immediate, type Db } from '../../db/client';
import { HttpError, unavailableError } from '../../middleware/error';
import { generateToken, hashToken, tokensEqual } from '../../utils/tokens';
import {
  claimLetter,
  completeLetter,
  expireStaleReadingLetters,
  expireUnopenedLetters,
  findLetterById,
  findLetterByTokenHash,
  markLetterReading,
  type LetterRow,
} from '../letters/repository';
import {
  canComplete,
  canOpen,
  clampProgress,
  decideClaim,
  isLetterTerminal,
  isSessionActive,
  nextEpoch,
  type SessionSnapshot,
  type SessionState,
} from '../letters/state';
import { themeSchema, type ThemeSelection } from '../letters/validation';
import {
  advanceProgress,
  completeSession,
  expireSessions,
  findSessionById,
  insertSession,
  invalidateSession,
  openSession,
  refreshHeartbeat,
  type SessionRow,
} from './session';

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

export interface ReadingState {
  state: SessionState;
  progress: number;
}

export interface LetterView {
  id: string;
  title: string;
  message: string;
  senderName: string | null;
  recipientName: string | null;
  signature: string | null;
  theme: ThemeSelection;
}

export interface ClaimResult {
  sessionId: string;
  location: string;
  /** null quando a sessão foi retomada pelo cookie: nenhum cookie deve ser reemitido. */
  readerToken: string | null;
}

export interface ExpirationResult {
  lettersExpired: number;
  sessionsExpired: number;
}

function requireSession(
  db: Db,
  config: AppConfig,
  sessionId: string,
  cookieToken: string | null,
): SessionRow {
  if (cookieToken === null) {
    throw new HttpError(401, 'Cookie de leitura ausente.');
  }

  const session = findSessionById(db, sessionId);
  if (session === undefined) {
    throw new HttpError(403, 'Sessão não encontrada.');
  }

  const presentedHash = hashToken(cookieToken, config.tokenHmacSecret);
  if (!tokensEqual(presentedHash, session.token_hash)) {
    throw new HttpError(403, 'Cookie de leitura inválido para esta sessão.');
  }

  return session;
}

function snapshot(session: SessionRow | undefined): SessionSnapshot | null {
  if (session === undefined) {
    return null;
  }

  return { state: session.state, graceUntil: session.grace_until };
}

function toLetterView(row: LetterRow): LetterView {
  const parsed = themeSchema.safeParse(JSON.parse(row.theme_json) as unknown);
  if (!parsed.success) {
    throw new HttpError(500, 'Erro interno');
  }

  return {
    id: row.id,
    title: row.title,
    message: row.message,
    senderName: row.sender_anonymous === 1 ? null : row.sender_name,
    recipientName: row.recipient_name,
    signature: row.signature,
    theme: parsed.data,
  };
}

/**
 * Consome o link de leitura. Toda a decisão e todas as mutações acontecem
 * dentro de uma única transação BEGIN IMMEDIATE.
 */
export function claimReading(
  db: Db,
  config: AppConfig,
  linkToken: string,
  cookieToken: string | null,
  now: number = Date.now(),
): ClaimResult {
  const linkHash = hashToken(linkToken, config.tokenHmacSecret);

  return immediate(db, () => {
    const letter = findLetterByTokenHash(db, linkHash);
    if (letter === undefined) {
      throw unavailableError();
    }

    const current =
      letter.current_session_id === null
        ? undefined
        : findSessionById(db, letter.current_session_id);

    // Portador do cookie válido retoma a mesma sessão, sem emitir novo cookie.
    if (cookieToken !== null && current !== undefined && isSessionActive(current.state)) {
      const presentedHash = hashToken(cookieToken, config.tokenHmacSecret);
      if (tokensEqual(presentedHash, current.token_hash)) {
        return {
          sessionId: current.id,
          location: `/leitura/${current.id}`,
          readerToken: null,
        };
      }
    }

    const decision = decideClaim(
      { state: letter.state, expiresAt: letter.expires_at },
      snapshot(current),
      now,
    );

    if (decision === 'claim') {
      const sessionId = randomUUID();
      if (!claimLetter(db, { letterId: letter.id, sessionId, now })) {
        // Outra requisição ganhou a corrida; nenhuma sessão é criada aqui.
        throw unavailableError();
      }

      const readerToken = generateToken();
      insertSession(db, {
        id: sessionId,
        letterId: letter.id,
        tokenHash: hashToken(readerToken, config.tokenHmacSecret),
        epoch: 0,
        lastProgress: 0,
        now,
        graceUntil: now + config.sessionGraceMinutes * MINUTE_MS,
      });

      return {
        sessionId,
        location: `/leitura/${sessionId}`,
        readerToken,
      };
    }

    if (decision === 'resume') {
      if (current === undefined) {
        throw unavailableError();
      }

      invalidateSession(db, current.id);

      const sessionId = randomUUID();
      const readerToken = generateToken();
      insertSession(db, {
        id: sessionId,
        letterId: letter.id,
        tokenHash: hashToken(readerToken, config.tokenHmacSecret),
        epoch: nextEpoch(current.epoch),
        lastProgress: current.last_progress,
        now,
        graceUntil: now + config.sessionGraceMinutes * MINUTE_MS,
      });

      // O link é descartado permanentemente: ninguém mais o reutiliza.
      const discardedToken = generateToken();
      const discardedHash = hashToken(discardedToken, config.tokenHmacSecret);
      db.prepare('UPDATE letters SET token_hash = ?, current_session_id = ? WHERE id = ?')
        .run(discardedHash, sessionId, letter.id);

      return {
        sessionId,
        location: `/leitura/${sessionId}`,
        readerToken,
      };
    }

    throw unavailableError();
  });
}

/** Nunca devolve conteúdo da carta: apenas estado e progresso. */
export function getReadingState(
  db: Db,
  config: AppConfig,
  sessionId: string,
  cookieToken: string | null,
): ReadingState {
  const session = requireSession(db, config, sessionId, cookieToken);
  return { state: session.state, progress: session.last_progress };
}

/** Único endpoint autorizado a entregar o conteúdo da carta. */
export function openReading(
  db: Db,
  config: AppConfig,
  sessionId: string,
  cookieToken: string | null,
  now: number = Date.now(),
): LetterView {
  return immediate(db, () => {
    const session = requireSession(db, config, sessionId, cookieToken);

    if (!canOpen(session.state)) {
      throw unavailableError();
    }

    if (session.state === 'opening' && !openSession(db, sessionId, now)) {
      const fresh = findSessionById(db, sessionId);
      if (fresh === undefined || fresh.state !== 'reading') {
        throw unavailableError();
      }
    }

    markLetterReading(db, session.letter_id, sessionId);

    const letter = findLetterById(db, session.letter_id);
    if (letter === undefined || isLetterTerminal(letter.state)) {
      throw unavailableError();
    }

    return toLetterView(letter);
  });
}

export function updateProgress(
  db: Db,
  config: AppConfig,
  sessionId: string,
  cookieToken: string | null,
  progress: number,
  now: number = Date.now(),
): { progress: number } {
  return immediate(db, () => {
    const session = requireSession(db, config, sessionId, cookieToken);

    if (!canOpen(session.state)) {
      return { progress: session.last_progress };
    }

    const next = clampProgress(progress);
    if (!advanceProgress(db, sessionId, next, now)) {
      // Sem avanço: mantém o heartbeat, mas preserva o progresso monotônico.
      refreshHeartbeat(db, sessionId, now);
    }

    const fresh = findSessionById(db, sessionId);
    return { progress: fresh?.last_progress ?? next };
  });
}

export function completeReading(
  db: Db,
  config: AppConfig,
  sessionId: string,
  cookieToken: string | null,
  now: number = Date.now(),
): { state: 'completed' } {
  return immediate(db, () => {
    const session = requireSession(db, config, sessionId, cookieToken);

    if (session.state === 'completed') {
      return { state: 'completed' };
    }

    if (!canComplete(session.state)) {
      throw unavailableError();
    }

    if (completeSession(db, sessionId, now)) {
      completeLetter(db, { letterId: session.letter_id, sessionId, now });
    }

    return { state: 'completed' };
  });
}

/** Job de limpeza: nunca sobrescreve cartas já concluídas. */
export function expireStale(
  db: Db,
  config: AppConfig,
  now: number = Date.now(),
): ExpirationResult {
  return immediate(db, () => {
    const staleBefore = now - config.heartbeatTtlSeconds * SECOND_MS;
    const sessionsExpired = expireSessions(db, now, staleBefore);
    const lettersExpired =
      expireUnopenedLetters(db, now) + expireStaleReadingLetters(db, now);

    return { lettersExpired, sessionsExpired };
  });
}
