import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config';
import { immediate, type Db } from '../../db/client';
import { HttpError, unavailableError } from '../../middleware/error';
import { generateToken, hashToken, tokensEqual } from '../../utils/tokens';
import { ORPHAN_ASSET_TTL_MS } from '../assets/service';
import { deleteOrphanAssets } from '../assets/repository';
import {
  claimLetter,
  completeLetter,
  expireStaleReadingLetters,
  expireUnopenedLetters,
  findLetterById,
  findLetterByTokenHash,
  markLetterReading,
  purgeLetterContent,
  type LetterRow,
} from '../letters/repository';
import {
  canComplete,
  canOpen,
  clampProgress,
  decideClaim,
  isSessionActive,
  nextEpoch,
  type SessionSnapshot,
  type SessionState,
} from '../letters/state';
import { themeSchema, type ThemeSelection } from '../letters/validation';
import { enforceReadingDeadline, readingDeadlines } from './deadlines';
import {
  advanceProgress,
  completeSession,
  expireSessions,
  findSessionById,
  findSessionByTokenHash,
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
  readDeadlineAt: number;
  idleDeadlineAt: number;
  fadeEnabled: boolean;
  sealAssetId: string | null;
}

export interface HeartbeatResult {
  state: SessionState;
  progress: number;
  readDeadlineAt: number;
  idleDeadlineAt: number;
}

export interface LetterView {
  id: string;
  title: string;
  message: string;
  senderName: string | null;
  recipientName: string | null;
  signature: string | null;
  theme: ThemeSelection;
  fadeEnabled: boolean;
  readDeadlineAt: number;
  idleDeadlineAt: number;
  sealAssetId: string | null;
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
  assetsDeleted: number;
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

function parseTheme(row: LetterRow): ThemeSelection {
  const parsed = themeSchema.safeParse(JSON.parse(row.theme_json) as unknown);
  if (!parsed.success) {
    throw new HttpError(500, 'Erro interno');
  }

  return parsed.data;
}

function toLetterView(row: LetterRow, session: SessionRow, config: AppConfig): LetterView {
  const deadlines = readingDeadlines(session, row, config);

  return {
    id: row.id,
    title: row.title,
    message: row.message,
    senderName: row.sender_anonymous === 1 ? null : row.sender_name,
    recipientName: row.recipient_name,
    signature: row.signature,
    theme: parseTheme(row),
    fadeEnabled: row.fade_enabled !== 0,
    readDeadlineAt: deadlines.readDeadlineAt,
    idleDeadlineAt: deadlines.idleDeadlineAt,
    sealAssetId: row.seal_asset_id,
  };
}

function toReadingState(
  session: SessionRow,
  letter: LetterRow,
  config: AppConfig,
  state: SessionState = session.state,
): ReadingState {
  const deadlines = readingDeadlines(session, letter, config);

  return {
    state,
    progress: session.last_progress,
    readDeadlineAt: deadlines.readDeadlineAt,
    idleDeadlineAt: deadlines.idleDeadlineAt,
    fadeEnabled: letter.fade_enabled !== 0,
    sealAssetId: letter.seal_asset_id,
  };
}

/**
 * Consome o link de leitura. Toda a decisão e todas as mutações acontecem
 * dentro de uma única transação BEGIN IMMEDIATE. `null` significa indisponível:
 * o erro HTTP é lançado fora da transação para não desfazer a limpeza.
 */
export function claimReading(
  db: Db,
  config: AppConfig,
  linkToken: string,
  cookieToken: string | null,
  now: number = Date.now(),
): ClaimResult {
  const linkHash = hashToken(linkToken, config.tokenHmacSecret);

  const result = immediate<ClaimResult | null>(db, () => {
    const letter = findLetterByTokenHash(db, linkHash);
    if (letter === undefined) {
      return null;
    }

    const current =
      letter.current_session_id === null
        ? undefined
        : findSessionById(db, letter.current_session_id);

    // Portador do cookie válido retoma a mesma sessão, sem emitir novo cookie.
    // Um cookie inválido/antigo NUNCA autoriza retomar a sessão atual.
    if (cookieToken !== null) {
      const cookieHash = hashToken(cookieToken, config.tokenHmacSecret);
      const cookieSession = findSessionByTokenHash(db, cookieHash);

      if (
        cookieSession === undefined ||
        cookieSession.letter_id !== letter.id ||
        !isSessionActive(cookieSession.state) ||
        (current !== undefined && current.id !== cookieSession.id) ||
        (current === undefined && letter.current_session_id !== cookieSession.id)
      ) {
        return null;
      }

      if (enforceReadingDeadline(db, cookieSession, letter, config, now)) {
        return null;
      }

      return {
        sessionId: cookieSession.id,
        location: `/leitura/${cookieSession.id}`,
        readerToken: null,
      };
    }

    if (
      current !== undefined &&
      isSessionActive(current.state) &&
      enforceReadingDeadline(db, current, letter, config, now)
    ) {
      return null;
    }

    if (current === undefined && now >= letter.expires_at) {
      purgeLetterContent(db, letter.id);
      return null;
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
        return null;
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
        return null;
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

    return null;
  });

  if (result === null) {
    throw unavailableError();
  }

  return result;
}

/** Nunca devolve conteúdo da carta: apenas estado, prazos e progresso. */
export function getReadingState(
  db: Db,
  config: AppConfig,
  sessionId: string,
  cookieToken: string | null,
  now: number = Date.now(),
): ReadingState {
  return immediate(db, () => {
    const session = requireSession(db, config, sessionId, cookieToken);
    const letter = findLetterById(db, session.letter_id);
    if (letter === undefined) {
      throw unavailableError();
    }

    if (enforceReadingDeadline(db, session, letter, config, now)) {
      return toReadingState(session, letter, config, 'expired');
    }

    return toReadingState(session, letter, config);
  });
}

/** Único endpoint autorizado a entregar o conteúdo da carta. */
export function openReading(
  db: Db,
  config: AppConfig,
  sessionId: string,
  cookieToken: string | null,
  now: number = Date.now(),
): LetterView {
  const result = immediate<LetterView | null>(db, () => {
    const session = requireSession(db, config, sessionId, cookieToken);
    const letter = findLetterById(db, session.letter_id);
    if (letter === undefined) {
      return null;
    }

    if (enforceReadingDeadline(db, session, letter, config, now)) {
      return null;
    }
    if (!canOpen(session.state)) {
      return null;
    }

    // Valida o tema antes de qualquer mutação, para não confirmar abertura com erro.
    parseTheme(letter);

    if (session.state === 'opening' && !openSession(db, sessionId, now)) {
      const fresh = findSessionById(db, sessionId);
      if (fresh === undefined || fresh.state !== 'reading') {
        return null;
      }
    }

    markLetterReading(db, session.letter_id, sessionId);

    const freshLetter = findLetterById(db, session.letter_id);
    const freshSession = findSessionById(db, sessionId);
    if (freshLetter === undefined || freshSession === undefined) {
      return null;
    }

    return toLetterView(freshLetter, freshSession, config);
  });

  if (result === null) {
    throw unavailableError();
  }

  return result;
}

export function updateProgress(
  db: Db,
  config: AppConfig,
  sessionId: string,
  cookieToken: string | null,
  progress: number,
  now: number = Date.now(),
): { progress: number } {
  const result = immediate<{ progress: number } | null>(db, () => {
    const session = requireSession(db, config, sessionId, cookieToken);
    const letter = findLetterById(db, session.letter_id);
    if (letter === undefined) {
      return null;
    }

    if (enforceReadingDeadline(db, session, letter, config, now)) {
      return null;
    }
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

  if (result === null) {
    throw unavailableError();
  }

  return result;
}

export function heartbeat(
  db: Db,
  config: AppConfig,
  sessionId: string,
  cookieToken: string | null,
  now: number = Date.now(),
): HeartbeatResult {
  const result = immediate<HeartbeatResult | null>(db, () => {
    const session = requireSession(db, config, sessionId, cookieToken);
    const letter = findLetterById(db, session.letter_id);
    if (letter === undefined) {
      return null;
    }

    if (enforceReadingDeadline(db, session, letter, config, now)) {
      return null;
    }
    if (!isSessionActive(session.state)) {
      return null;
    }

    refreshHeartbeat(db, sessionId, now);
    const fresh = findSessionById(db, sessionId);
    if (fresh === undefined) {
      return null;
    }

    const deadlines = readingDeadlines(fresh, letter, config);
    return {
      state: fresh.state,
      progress: fresh.last_progress,
      readDeadlineAt: deadlines.readDeadlineAt,
      idleDeadlineAt: deadlines.idleDeadlineAt,
    };
  });

  if (result === null) {
    throw unavailableError();
  }

  return result;
}

export function completeReading(
  db: Db,
  config: AppConfig,
  sessionId: string,
  cookieToken: string | null,
  now: number = Date.now(),
): { state: 'completed' } {
  const result = immediate<{ state: 'completed' } | null>(db, () => {
    const session = requireSession(db, config, sessionId, cookieToken);
    const letter = findLetterById(db, session.letter_id);
    if (letter === undefined) {
      return null;
    }

    if (enforceReadingDeadline(db, session, letter, config, now)) {
      return null;
    }
    if (session.state === 'completed') {
      return { state: 'completed' };
    }
    if (!canComplete(session.state)) {
      return null;
    }

    if (completeSession(db, sessionId, now)) {
      completeLetter(db, { letterId: session.letter_id, sessionId, now });
    }

    return { state: 'completed' };
  });

  if (result === null) {
    throw unavailableError();
  }

  return result;
}

/** Job de limpeza: nunca sobrescreve cartas já concluídas. */
export function expireStale(
  db: Db,
  config: AppConfig,
  now: number = Date.now(),
): ExpirationResult {
  return immediate(db, () => {
    const idleBefore = now - config.idleTimeoutSeconds * SECOND_MS;
    const sessionsExpired = expireSessions(db, idleBefore);
    const lettersExpired =
      expireUnopenedLetters(db, now) + expireStaleReadingLetters(db);
    const assetsDeleted = deleteOrphanAssets(db, now - ORPHAN_ASSET_TTL_MS);

    return { lettersExpired, sessionsExpired, assetsDeleted };
  });
}
