import { describe, expect, it } from 'vitest';
import {
  blockProgress,
  clamp,
  dwellForWords,
  MAX_DWELL_MS,
  mergeProgress,
  shouldComplete,
} from './readingLine';

describe('clamp', () => {
  it('limita valores aos limites padrão', () => {
    expect(clamp(-10)).toBe(0);
    expect(clamp(0)).toBe(0);
    expect(clamp(0.42)).toBe(0.42);
    expect(clamp(1)).toBe(1);
    expect(clamp(12)).toBe(1);
  });

  it('respeita limites customizados', () => {
    expect(clamp(-5, 2, 8)).toBe(2);
    expect(clamp(5, 2, 8)).toBe(5);
    expect(clamp(50, 2, 8)).toBe(8);
  });
});

describe('blockProgress', () => {
  it('retorna 0 antes da linha e 1 depois da zona de transição', () => {
    expect(blockProgress(700, 150, 900)).toBe(0);
    expect(blockProgress(700, 150, 700)).toBe(0);
    expect(blockProgress(700, 150, 625)).toBe(0.5);
    expect(blockProgress(700, 150, 550)).toBe(1);
    expect(blockProgress(700, 150, 100)).toBe(1);
  });

  it('é estável quando a zona de transição não tem altura', () => {
    expect(blockProgress(700, 0, 701)).toBe(0);
    expect(blockProgress(700, 0, 700)).toBe(1);
  });
});

describe('dwellForWords', () => {
  it('aplica o piso de 1000 ms e cresce com o número de palavras', () => {
    expect(MAX_DWELL_MS).toBe(6000);
    expect(dwellForWords(0)).toBe(1000);
    expect(dwellForWords(10)).toBe(1000);
    expect(dwellForWords(11)).toBe(1000);
    expect(dwellForWords(14)).toBe(1000);
    expect(dwellForWords(20)).toBe(1200);
    expect(dwellForWords(50)).toBe(3000);
  });

  it('limita o dwell a 6 s para que cartas longas possam concluir', () => {
    expect(dwellForWords(100)).toBe(6000);
    expect(dwellForWords(134)).toBe(6000);
    expect(dwellForWords(4000)).toBe(6000);
  });
});

describe('mergeProgress', () => {
  it('é monotônica e preserva o maior valor já visto', () => {
    expect(mergeProgress(0, 0.4)).toBe(0.4);
    expect(mergeProgress(0.4, 0.1)).toBe(0.4);
    expect(mergeProgress(1, 0.2)).toBe(1);
    expect(mergeProgress(0.75, 0.75)).toBe(0.75);
  });
});

describe('shouldComplete', () => {
  const complete = {
    globalProgress: 0.99,
    lastBlockProgress: 0.96,
    sentinelVisible: true,
    dwellMs: 1000,
    requiredDwellMs: 1000,
  };

  it('conclui somente quando todas as condições são satisfeitas', () => {
    expect(shouldComplete(complete)).toBe(true);
  });

  it('bloqueia a conclusão se qualquer condição faltar', () => {
    expect(shouldComplete({ ...complete, globalProgress: 0.97 })).toBe(false);
    expect(shouldComplete({ ...complete, lastBlockProgress: 0.94 })).toBe(false);
    expect(shouldComplete({ ...complete, sentinelVisible: false })).toBe(false);
    expect(shouldComplete({ ...complete, dwellMs: 999 })).toBe(false);
  });

  it('aceita os valores limítrofes exatos', () => {
    expect(
      shouldComplete({
        globalProgress: 0.98,
        lastBlockProgress: 0.95,
        sentinelVisible: true,
        dwellMs: 1000,
        requiredDwellMs: 1000,
      }),
    ).toBe(true);
  });
});
