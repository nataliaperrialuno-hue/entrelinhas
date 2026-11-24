export type LetterState = 'unopened' | 'opening' | 'reading' | 'completed' | 'expired';
export type SessionState = 'opening' | 'reading' | 'completed' | 'expired' | 'invalidated';

export interface LetterSnapshot {
  state: LetterState;
  expiresAt: number;
}

export interface SessionSnapshot {
  state: SessionState;
  graceUntil: number;
}

export type ClaimDecision = 'claim' | 'resume' | 'unavailable';

export function isLetterTerminal(state: LetterState): boolean {
  return state === 'completed' || state === 'expired';
}

export function isSessionActive(state: SessionState): boolean {
  return state === 'opening' || state === 'reading';
}

export function canOpen(state: SessionState): boolean {
  return isSessionActive(state);
}

export function canComplete(state: SessionState): boolean {
  return isSessionActive(state);
}

/**
 * Decisão pura sobre o que fazer quando um link de leitura é apresentado.
 * A validade expira no exato instante `expiresAt` (`expires_at <= now`).
 */
export function decideClaim(
  letter: LetterSnapshot,
  session: SessionSnapshot | null,
  now: number,
): ClaimDecision {
  if (now >= letter.expiresAt) {
    return 'unavailable';
  }

  if (letter.state === 'unopened') {
    return 'claim';
  }

  if (
    (letter.state === 'opening' || letter.state === 'reading') &&
    session !== null &&
    isSessionActive(session.state) &&
    now <= session.graceUntil
  ) {
    return 'resume';
  }

  return 'unavailable';
}

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

export function nextEpoch(epoch: number): number {
  return epoch + 1;
}
