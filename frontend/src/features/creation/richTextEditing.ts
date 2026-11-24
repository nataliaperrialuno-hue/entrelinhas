/**
 * Lógica pura de inserção de marcadores no textarea. Nenhuma função aqui toca
 * o DOM: o componente apenas aplica o resultado e restaura a seleção.
 */

export interface WrapSelectionResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Envolve a seleção com `open`/`close`. Sem seleção, insere `placeholder` já
 * selecionado para que a próxima digitação substitua o texto de exemplo.
 * Se a seleção já estiver exatamente envolvida pelos marcadores, desfaz.
 */
export function wrapSelection(
  text: string,
  start: number,
  end: number,
  open: string,
  close: string,
  placeholder: string,
): WrapSelectionResult {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  const before = text.slice(0, safeStart);
  const selected = text.slice(safeStart, safeEnd);
  const after = text.slice(safeEnd);

  if (safeStart !== safeEnd && before.endsWith(open) && after.startsWith(close)) {
    const value =
      before.slice(0, before.length - open.length) + selected + after.slice(close.length);
    const selectionStart = safeStart - open.length;
    return { value, selectionStart, selectionEnd: selectionStart + selected.length };
  }

  const inner = selected.length > 0 ? selected : placeholder;
  return {
    value: before + open + inner + close + after,
    selectionStart: safeStart + open.length,
    selectionEnd: safeStart + open.length + inner.length,
  };
}

/**
 * Insere um token (ex.: `[[foto:<id>]]`) no caret, substituindo a seleção.
 * O caret resultante fica logo após o token inserido. Índices fora do intervalo
 * são normalizados para não corromper o texto.
 */
export function insertToken(
  text: string,
  start: number,
  end: number,
  token: string,
): WrapSelectionResult {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  const caret = safeStart + token.length;

  return {
    value: text.slice(0, safeStart) + token + text.slice(safeEnd),
    selectionStart: caret,
    selectionEnd: caret,
  };
}
