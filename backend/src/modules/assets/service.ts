import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config';
import type { Db } from '../../db/client';
import { HttpError } from '../../middleware/error';
import { generateToken, hashToken, tokensEqual } from '../../utils/tokens';
import { findLetterById } from '../letters/repository';
import { isLetterTerminal } from '../letters/state';
import { isReadingExpired } from '../reading/deadlines';
import { findSessionByTokenHash } from '../reading/session';
import { inspectImage } from './image';
import {
  attachAsset,
  findAssetById,
  findAttachedAsset,
  insertAsset,
  type AssetRow,
} from './repository';
import {
  MAX_PHOTO_BYTES,
  MAX_SEAL_BYTES,
  type AssetContentType,
  type AssetKind,
} from './validation';

/** Limites autoritativos do servidor (o cliente apenas faz UX). */
export { MAX_PHOTO_BYTES, MAX_SEAL_BYTES } from './validation';
export const ORPHAN_ASSET_TTL_MS = 60 * 60 * 1_000;

export interface UploadedAsset {
  id: string;
  uploadToken: string;
}

export interface StoredAsset {
  mime: string;
  data: Uint8Array;
}

function tooLarge(kind: AssetKind): never {
  throw new HttpError(
    413,
    kind === 'photo'
      ? 'Foto muito grande (máximo 2 MiB).'
      : 'Selo muito grande (máximo 16 KiB).',
  );
}

export function uploadAsset(
  db: Db,
  config: AppConfig,
  input: { kind: AssetKind; contentType: AssetContentType; bytes: Uint8Array },
): UploadedAsset {
  const limit = input.kind === 'photo' ? MAX_PHOTO_BYTES : MAX_SEAL_BYTES;
  if (input.bytes.byteLength > limit) {
    tooLarge(input.kind);
  }
  if (input.kind === 'seal' && input.contentType === 'image/jpeg') {
    throw new HttpError(400, 'O selo deve ser PNG ou WebP.');
  }

  const info = inspectImage(input.bytes);
  if (info.mime !== input.contentType) {
    throw new HttpError(400, 'O conteúdo não corresponde ao tipo informado.');
  }

  const id = randomUUID();
  const uploadToken = generateToken();

  insertAsset(db, {
    id,
    kind: input.kind,
    mime: input.contentType,
    width: info.width,
    height: info.height,
    byteSize: input.bytes.byteLength,
    data: input.bytes,
    uploadTokenHash: hashToken(uploadToken, config.tokenHmacSecret),
    createdAt: Date.now(),
  });

  // O token cru existe apenas nesta resposta; o banco guarda somente o HMAC.
  return { id, uploadToken };
}

/** Valida e vincula uma referência enviada no rascunho da carta. */
export function bindUploadedAsset(
  db: Db,
  config: AppConfig,
  params: { id: string; uploadToken: string; letterId: string },
): AssetRow {
  const asset = findAssetById(db, params.id);
  if (
    asset === undefined ||
    asset.attached !== 0 ||
    asset.letter_id !== null ||
    asset.upload_token_hash === null
  ) {
    throw new HttpError(400, 'Asset inválido ou já utilizado.');
  }

  const presentedHash = hashToken(params.uploadToken, config.tokenHmacSecret);
  if (!tokensEqual(presentedHash, asset.upload_token_hash)) {
    throw new HttpError(400, 'Token de asset inválido.');
  }

  if (!attachAsset(db, { id: asset.id, letterId: params.letterId, uploadTokenHash: presentedHash })) {
    throw new HttpError(400, 'Asset já vinculado a outra carta.');
  }

  return asset;
}

/**
 * Serve o BLOB apenas para a sessão de leitura dona da carta. Qualquer falha
 * de autorização resulta em 404, sem distinção entre "não existe" e "sem acesso".
 */
export function getAssetForReading(
  db: Db,
  config: AppConfig,
  assetId: string,
  cookieToken: string | null,
  now: number = Date.now(),
): StoredAsset {
  const notFound = (): never => {
    throw new HttpError(404, 'Asset não encontrado.');
  };

  if (cookieToken === null) {
    throw notFound();
  }

  const session = findSessionByTokenHash(db, hashToken(cookieToken, config.tokenHmacSecret));
  if (session === undefined) {
    throw notFound();
  }

  const asset = findAttachedAsset(db, assetId, session.letter_id);
  if (asset === undefined) {
    throw notFound();
  }

  const letter = findLetterById(db, session.letter_id);
  if (
    letter === undefined ||
    letter.state !== session.state ||
    letter.current_session_id !== session.id ||
    isLetterTerminal(letter.state) ||
    isReadingExpired(session, letter, config, now)
  ) {
    throw notFound();
  }

  return { mime: asset.mime, data: asset.data };
}
