/**
 * Matemática pura da linha de leitura. Nenhuma função desta página toca o DOM:
 * o hook `useFadeOnScroll` é responsável por aplicar os valores calculados aqui.
 */

/** Limita `value` ao intervalo [min, max]. */
export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Progresso de um bloco em relação à linha de leitura.
 *
 * O valor é 0 enquanto o bloco estiver abaixo da linha e chega a 1 quando o
 * bloco ultrapassou a linha por `fadeSpan` pixels.
 */
export function blockProgress(lineY: number, fadeSpan: number, rectBottom: number): number {
  if (fadeSpan <= 0) {
    return rectBottom <= lineY ? 1 : 0;
  }
  return clamp((lineY - rectBottom) / fadeSpan);
}

/** Tempo mínimo de permanência de um bloco acima da linha, em milissegundos. */
export function dwellForWords(words: number): number {
  return Math.max(400, words * 30);
}

export interface ShouldCompleteArgs {
  globalProgress: number;
  lastBlockProgress: number;
  sentinelVisible: boolean;
  dwellMs: number;
  requiredDwellMs: number;
}

/** Todas as condições de conclusão automática devem ser satisfeitas. */
export function shouldComplete({
  globalProgress,
  lastBlockProgress,
  sentinelVisible,
  dwellMs,
  requiredDwellMs,
}: ShouldCompleteArgs): boolean {
  return (
    globalProgress >= 0.98 &&
    lastBlockProgress >= 0.95 &&
    sentinelVisible &&
    dwellMs >= requiredDwellMs
  );
}

/** O progresso nunca regreda, mesmo quando o usuário rola a página para cima. */
export function mergeProgress(previous: number, next: number): number {
  return Math.max(previous, next);
}
