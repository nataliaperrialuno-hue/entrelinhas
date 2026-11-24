import type { AppConfig } from '../../config';
import type { Db } from '../../db/client';
import { purgeLetterContent, type LetterRow } from '../letters/repository';
import { isSessionActive } from '../letters/state';
import { expireSessionById, type SessionRow } from './session';

const SECOND_MS = 1_000;

export interface ReadingDeadlines {
  readDeadlineAt: number;
  idleDeadlineAt: number;
}

/** O prazo absoluto é calculado a partir da criação da sessão, nunca do cliente. */
export function readingDeadlines(
  session: SessionRow,
  letter: LetterRow,
  config: AppConfig,
): ReadingDeadlines {
  const seconds = letter.read_time_limit_seconds ?? config.defaultReadTimeLimitSeconds;

  return {
    readDeadlineAt: session.created_at + seconds * SECOND_MS,
    idleDeadlineAt: session.last_seen_at + config.idleTimeoutSeconds * SECOND_MS,
  };
}

/**
 * Inatividade é estritamente maior que 10 minutos; no instante exato o cookie
 * ainda serve. O prazo absoluto vence no instante exato (`now >= prazo`).
 */
export function isReadingExpired(
  session: SessionRow,
  letter: LetterRow,
  config: AppConfig,
  now: number,
): boolean {
  const deadlines = readingDeadlines(session, letter, config);

  return (
    now >= deadlines.readDeadlineAt ||
    now > deadlines.idleDeadlineAt ||
    now >= letter.expires_at
  );
}

/**
 * Helper de domínio: chamado dentro de `immediate()` por todas as rotas de
 * leitura e pelo atalho de cookie. Limpa texto e assets atomicamente.
 * Retorna `true` quando o prazo tinha vencido (o chamador decidirá o status).
 */
export function enforceReadingDeadline(
  db: Db,
  session: SessionRow,
  letter: LetterRow,
  config: AppConfig,
  now: number,
): boolean {
  // Cartas concluídas são imutáveis: o histórico não é reaberto por prazo.
  if (letter.state === 'completed' || session.state === 'completed') {
    return false;
  }

  if (!isReadingExpired(session, letter, config, now)) {
    return false;
  }

  if (isSessionActive(session.state)) {
    expireSessionById(db, session.id);
  }

  // Uma sessão antiga/invalidada não pode apagar a carta da sessão atual.
  if (letter.current_session_id === session.id) {
    purgeLetterContent(db, letter.id);
  }

  return true;
}
