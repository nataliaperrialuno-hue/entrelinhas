/** Limite compartilhado de palavras por carta. */
export const MAX_LETTER_WORDS = 4000;
/** Teto de segurança em caracteres (inclui marcadores de formatação). */
export const MAX_LETTER_CHARS = 100000;
/** Número máximo de fotos por carta. */
export const MAX_PHOTOS = 3;
/** Teto por foto, validado no cliente apenas como UX (o servidor é a autoridade). */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
/** Teto para o PNG do selo desenhado. */
export const MAX_SEAL_BYTES = 16 * 1024;
/** Intervalo aceito para o prazo de leitura, em segundos. */
export const MIN_READ_SECONDS = 60;
export const MAX_READ_SECONDS = 3600;
export const DEFAULT_READ_SECONDS = 600;
/** Conta palavras separadas por whitespace. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
