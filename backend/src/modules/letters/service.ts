import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config';
import { immediate, type Db } from '../../db/client';
import { generateToken, hashToken } from '../../utils/tokens';
import { insertLetter } from './repository';
import type { LetterDraft } from './validation';

export interface CreateLetterResult {
  url: string;
}

const DAY_MS = 86_400_000;

export function createLetter(
  db: Db,
  config: AppConfig,
  draft: LetterDraft,
): CreateLetterResult {
  const linkToken = generateToken();
  const tokenHash = hashToken(linkToken, config.tokenHmacSecret);
  const id = randomUUID();
  const now = Date.now();

  immediate(db, () => {
    insertLetter(db, {
      id,
      tokenHash,
      draft,
      createdAt: now,
      expiresAt: now + config.letterTtlDays * DAY_MS,
    });
  });

  // O token cru existe apenas nesta resposta; o banco guarda somente o HMAC.
  return { url: `/c/${linkToken}` };
}
