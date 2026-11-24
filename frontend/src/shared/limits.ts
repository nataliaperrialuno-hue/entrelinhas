/** Limite compartilhado de palavras por carta. */
export const MAX_LETTER_WORDS = 4000;
/** Teto de segurança em caracteres (inclui marcadores de formatação). */
export const MAX_LETTER_CHARS = 100000;
/** Conta palavras separadas por whitespace. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
