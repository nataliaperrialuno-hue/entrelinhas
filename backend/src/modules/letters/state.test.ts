import { describe, expect, it } from 'vitest';
import {
  canComplete,
  canOpen,
  clampProgress,
  decideClaim,
  isLetterTerminal,
  isSessionActive,
  nextEpoch,
} from './state';

describe('transições puras de estado', () => {
  it('permite o primeiro claim apenas com carta não aberta e dentro da validade', () => {
    expect(
      decideClaim({ state: 'unopened', expiresAt: 1_000 }, null, 999),
    ).toBe('claim');
    expect(
      decideClaim({ state: 'opening', expiresAt: 1_000 }, null, 999),
    ).toBe('unavailable');
  });

  it('trata o instante exato de expiração como indisponível', () => {
    expect(
      decideClaim({ state: 'unopened', expiresAt: 1_000 }, null, 1_000),
    ).toBe('unavailable');
  });

  it('retoma somente com sessão ativa dentro da janela de carência', () => {
    expect(
      decideClaim(
        { state: 'opening', expiresAt: 10_000 },
        { state: 'opening', graceUntil: 5_000 },
        5_000,
      ),
    ).toBe('resume');

    expect(
      decideClaim(
        { state: 'reading', expiresAt: 10_000 },
        { state: 'reading', graceUntil: 5_000 },
        5_001,
      ),
    ).toBe('unavailable');

    expect(
      decideClaim(
        { state: 'reading', expiresAt: 10_000 },
        { state: 'invalidated', graceUntil: 9_000 },
        1_000,
      ),
    ).toBe('unavailable');
  });

  it('reconhece estados terminais e estados ativos', () => {
    expect(isLetterTerminal('completed')).toBe(true);
    expect(isLetterTerminal('expired')).toBe(true);
    expect(isLetterTerminal('reading')).toBe(false);

    expect(isSessionActive('opening')).toBe(true);
    expect(isSessionActive('reading')).toBe(true);
    expect(isSessionActive('expired')).toBe(false);
    expect(isSessionActive('invalidated')).toBe(false);

    expect(canOpen('opening')).toBe(true);
    expect(canOpen('completed')).toBe(false);
    expect(canComplete('reading')).toBe(true);
    expect(canComplete('expired')).toBe(false);
  });

  it('limita o progresso ao intervalo [0, 1] e rejeita valores não finitos', () => {
    expect(clampProgress(-2)).toBe(0);
    expect(clampProgress(0.35)).toBe(0.35);
    expect(clampProgress(7)).toBe(1);
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('incrementa a geração da sessão', () => {
    expect(nextEpoch(0)).toBe(1);
    expect(nextEpoch(4)).toBe(5);
  });
});
