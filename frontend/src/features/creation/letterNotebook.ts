/**
 * Bloco de notas local da criação: rascunhos e contador de cartas escritas.
 * Tudo fica apenas no localStorage do navegador — nenhum dado vai ao servidor.
 */

import type {
  EnvelopeId,
  LetterDraft,
  PaletteId,
  PaperId,
  SealId,
  ThemeSelection,
  TypographyId,
} from '../../shared/types';

export const DRAFTS_STORAGE_KEY = 'entrelinhas:drafts:v1';
export const WRITTEN_COUNT_STORAGE_KEY = 'entrelinhas:letters-written:v1';

/** Quantidade máxima de rascunhos guardados. */
export const MAX_DRAFTS = 10;
/** Teto aproximado (em bytes UTF-8) para o conjunto de rascunhos. */
export const MAX_DRAFTS_BYTES = 2 * 1024 * 1024;

const DEFAULT_FADE_ENABLED = true;
const DEFAULT_READ_SECONDS = 600;

const ENVELOPE_IDS: readonly EnvelopeId[] = ['classic', 'floral', 'minimal'];
const SEAL_IDS: readonly SealId[] = ['wine', 'gold', 'ink', 'custom'];
const PALETTE_IDS: readonly PaletteId[] = ['sepia', 'rose', 'night', 'sage'];
const TYPOGRAPHY_IDS: readonly TypographyId[] = ['serif', 'hand', 'mono'];
const PAPER_IDS: readonly PaperId[] = ['linen', 'plain', 'aged'];

/** Fotos são referências temporárias: nunca sobrevivem ao rascunho. */
const PHOTO_TOKEN_PATTERN = /\[\[foto:[^\]]*\]\]/g;

export interface DraftRecord {
  id: string;
  savedAt: number;
  draft: LetterDraft;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseTheme(value: unknown): ThemeSelection | null {
  if (!isRecord(value)) return null;

  const { envelope, seal, palette, typography, paper, inkColor } = value;
  if (!ENVELOPE_IDS.includes(envelope as EnvelopeId)) return null;
  if (!SEAL_IDS.includes(seal as SealId)) return null;
  if (!PALETTE_IDS.includes(palette as PaletteId)) return null;
  if (!TYPOGRAPHY_IDS.includes(typography as TypographyId)) return null;
  if (!PAPER_IDS.includes(paper as PaperId)) return null;

  const theme: ThemeSelection = {
    envelope: envelope as EnvelopeId,
    seal: seal as SealId,
    palette: palette as PaletteId,
    typography: typography as TypographyId,
    paper: paper as PaperId,
  };
  if (typeof inkColor === 'string') theme.inkColor = inkColor;
  return theme;
}

/**
 * Prepara o draft para o bloco de notas: sem marcadores de foto, sem assets e
 * sem selo desenhado. O tema é preservado (inclusive `seal: 'custom'`).
 */
export function serializeDraft(draft: LetterDraft): LetterDraft {
  return {
    ...draft,
    message: draft.message.replace(PHOTO_TOKEN_PATTERN, ''),
    assets: [],
    sealAssetId: null,
  };
}

/** Valida e normaliza um valor lido do armazenamento. Inválido → `null`. */
export function deserializeDraft(value: unknown): LetterDraft | null {
  if (!isRecord(value)) return null;

  const { senderName, senderAnonymous, recipientName, title, message, signature } = value;
  if (
    !isString(senderName) ||
    !isString(recipientName) ||
    !isString(title) ||
    !isString(message) ||
    !isString(signature) ||
    typeof senderAnonymous !== 'boolean'
  ) {
    return null;
  }

  const theme = parseTheme(value.theme);
  if (theme === null) return null;

  const readTimeLimitSeconds =
    typeof value.readTimeLimitSeconds === 'number' &&
    Number.isFinite(value.readTimeLimitSeconds) &&
    value.readTimeLimitSeconds > 0
      ? value.readTimeLimitSeconds
      : DEFAULT_READ_SECONDS;

  return serializeDraft({
    senderName,
    senderAnonymous,
    recipientName,
    title,
    message,
    signature,
    theme,
    fadeEnabled:
      typeof value.fadeEnabled === 'boolean' ? value.fadeEnabled : DEFAULT_FADE_ENABLED,
    readTimeLimitSeconds,
  });
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Modo privado/navegador sem storage: trate como ausência de dados.
    return null;
  }
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function storageError(error: unknown): Error {
  // DOMException não é necessariamente `instanceof Error` (jsdom e browsers antigos).
  const info = isRecord(error) ? error : {};
  const isQuota =
    info['name'] === 'QuotaExceededError' ||
    info['name'] === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    info['code'] === 22;
  if (isQuota) {
    return new Error(
      'O armazenamento do navegador está cheio. Libere espaço e tente novamente.',
    );
  }
  return new Error('Não foi possível guardar no armazenamento deste navegador. Tente novamente.');
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    throw storageError(error);
  }
}

function byteLength(value: string): number {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).length;
  return value.length * 2;
}

function createDraftId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function draftTooLargeError(): Error {
  return new Error(
    'Este rascunho é grande demais para o armazenamento do navegador. Reduza o texto.',
  );
}

/** Lista rascunhos válidos, do mais recente para o mais antigo. */
export function listDrafts(): DraftRecord[] {
  const parsed = parseJson(readRaw(DRAFTS_STORAGE_KEY));
  if (!Array.isArray(parsed)) return [];

  const records: DraftRecord[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const { id, savedAt, draft } = item;
    if (!isNonEmptyString(id)) continue;
    // Intervalo válido de Date: fora dele, `toISOString()` lançaria RangeError na UI.
    if (
      typeof savedAt !== 'number' ||
      !Number.isFinite(savedAt) ||
      savedAt < 0 ||
      savedAt > 8_640_000_000_000_000
    ) {
      continue;
    }
    const restored = deserializeDraft(draft);
    if (restored === null) continue;
    records.push({ id, savedAt, draft: restored });
  }
  return records;
}

/** Guarda um novo rascunho, respeitando contagem e teto de armazenamento. */
export function saveDraft(draft: LetterDraft): DraftRecord {
  const record: DraftRecord = {
    id: createDraftId(),
    savedAt: Date.now(),
    draft: serializeDraft(draft),
  };

  if (byteLength(JSON.stringify(record.draft)) > MAX_DRAFTS_BYTES) {
    throw draftTooLargeError();
  }

  const records = [record, ...listDrafts()].slice(0, MAX_DRAFTS);
  let json = JSON.stringify(records);
  while (records.length > 1 && byteLength(json) > MAX_DRAFTS_BYTES) {
    records.pop();
    json = JSON.stringify(records);
  }
  if (byteLength(json) > MAX_DRAFTS_BYTES) throw draftTooLargeError();

  writeJson(DRAFTS_STORAGE_KEY, records);
  return record;
}

/** Remove apenas o rascunho com o id informado. */
export function deleteDraft(id: string): void {
  writeJson(
    DRAFTS_STORAGE_KEY,
    listDrafts().filter((item) => item.id !== id),
  );
}

function normalizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

/** Quantidade de cartas já escritas neste navegador. */
export function getWrittenCount(): number {
  return normalizeCount(parseJson(readRaw(WRITTEN_COUNT_STORAGE_KEY)));
}

/** Incrementa e devolve o novo total de cartas escritas neste navegador. */
export function incrementWrittenCount(): number {
  const next = getWrittenCount() + 1;
  writeJson(WRITTEN_COUNT_STORAGE_KEY, next);
  return next;
}
