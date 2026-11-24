import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../../config';
import { immediate, type Db } from '../../db/client';
import { HttpError } from '../../middleware/error';
import { bindUploadedAsset } from '../assets/service';
import { generateToken, hashToken } from '../../utils/tokens';
import { insertLetter } from './repository';
import {
  MAX_PHOTOS,
  MAX_SEAL_ASSETS,
  PHOTO_MARKER_PATTERN,
  type LetterDraft,
} from './validation';

export interface CreateLetterResult {
  url: string;
}

const DAY_MS = 86_400_000;

/** Extrai os UUIDs dos marcadores `[[foto:<uuid>]]` presentes na mensagem. */
export function extractPhotoMarkers(message: string): string[] {
  return Array.from(message.matchAll(PHOTO_MARKER_PATTERN), (match) => match[1]);
}

function invalidAssets(): never {
  throw new HttpError(400, 'Assets da carta inválidos.');
}

export function createLetter(
  db: Db,
  config: AppConfig,
  draft: LetterDraft,
): CreateLetterResult {
  const linkToken = generateToken();
  const tokenHash = hashToken(linkToken, config.tokenHmacSecret);
  const id = randomUUID();
  const now = Date.now();
  const readTimeLimitSeconds = draft.readTimeLimitSeconds ?? config.defaultReadTimeLimitSeconds;
  const sealAssetId = draft.sealAssetId ?? null;
  const references = draft.assets ?? [];
  const markerIds = extractPhotoMarkers(draft.message);

  if (
    references.length > MAX_PHOTOS + MAX_SEAL_ASSETS ||
    markerIds.length > MAX_PHOTOS ||
    new Set(markerIds).size !== markerIds.length ||
    new Set(references.map((reference) => reference.id)).size !== references.length ||
    markerIds.some((marker) => !z.uuid().safeParse(marker).success)
  ) {
    invalidAssets();
  }

  immediate(db, () => {
    // A carta existe primeiro para satisfazer a FK dos assets; qualquer
    // falha de validação abaixo desfaz tudo no ROLLBACK da transação.
    insertLetter(db, {
      id,
      tokenHash,
      draft,
      readTimeLimitSeconds,
      sealAssetId,
      createdAt: now,
      expiresAt: now + config.letterTtlDays * DAY_MS,
    });

    // O HMAC do token é conferido antes de qualquer vínculo; a CAS do UPDATE
    // impede que um mesmo asset seja anexado a duas cartas em paralelo.
    const bound = references.map((reference) =>
      bindUploadedAsset(db, config, { ...reference, letterId: id }),
    );

    const photoIds = bound.filter((asset) => asset.kind === 'photo').map((asset) => asset.id);
    const sealIds = bound.filter((asset) => asset.kind === 'seal').map((asset) => asset.id);

    if (photoIds.length > MAX_PHOTOS || sealIds.length > MAX_SEAL_ASSETS) {
      invalidAssets();
    }
    if (
      photoIds.length !== markerIds.length ||
      markerIds.some((marker) => !photoIds.includes(marker))
    ) {
      invalidAssets();
    }
    if (
      sealAssetId === null
        ? sealIds.length > 0
        : sealIds.length !== 1 || sealIds[0] !== sealAssetId
    ) {
      invalidAssets();
    }

  });

  // O token cru existe apenas nesta resposta; o banco guarda somente o HMAC.
  return { url: `/c/${linkToken}` };
}
