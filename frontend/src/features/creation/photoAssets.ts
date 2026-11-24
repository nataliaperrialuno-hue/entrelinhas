/**
 * Helpers puros para fotos do editor. Nenhuma função decide confiabilidade
 * pelo nome do arquivo: apenas MIME e tamanho, como UX — o servidor é a autoridade.
 */

import { MAX_PHOTOS, MAX_PHOTO_BYTES } from '../../shared/limits';

export const PHOTO_ACCEPT = 'image/png,image/jpeg,image/webp';
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface PhotoValidation {
  accepted: File[];
  error: string | null;
}

export function isValidPhotoType(type: string): boolean {
  return ALLOWED_TYPES.has(type.toLowerCase());
}

/** Valida um lote e aceita quantos arquivos couberem no limite restante. */
export function validatePhotoFiles(
  files: readonly File[],
  currentCount: number,
): PhotoValidation {
  const accepted: File[] = [];
  const errors = new Set<string>();
  let count = Math.max(0, currentCount);

  for (const file of files) {
    if (!isValidPhotoType(file.type)) {
      errors.add('Use apenas imagens PNG, JPEG ou WebP.');
      continue;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      errors.add(`Cada foto pode ter até ${MAX_PHOTO_BYTES / (1024 * 1024)} MiB.`);
      continue;
    }
    if (count >= MAX_PHOTOS) {
      errors.add(`Você pode inserir no máximo ${MAX_PHOTOS} fotos por carta.`);
      continue;
    }
    accepted.push(file);
    count += 1;
  }

  return { accepted, error: errors.size > 0 ? Array.from(errors).join(' ') : null };
}

/** UUID v4 usado como id provisório do marcador enquanto o upload corre. */
export function createPhotoId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto !== undefined && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (webCrypto !== undefined && typeof webCrypto.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Troca o id provisório pelo id definitivo do servidor em todos os marcadores. */
export function replaceAssetIdInText(text: string, fromId: string, toId: string): string {
  if (fromId === toId) return text;
  return text.split(`[[foto:${fromId}]]`).join(`[[foto:${toId}]]`);
}

/** Remove os marcadores de uma foto que o remetente decidiu tirar. */
export function removeAssetToken(text: string, id: string): string {
  return text.split(`[[foto:${id}]]`).join('');
}
