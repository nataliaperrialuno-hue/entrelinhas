import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME } from '../../shared/themes';
import type { LetterDraft } from '../../shared/types';
import {
  deleteDraft,
  deserializeDraft,
  DRAFTS_STORAGE_KEY,
  getWrittenCount,
  incrementWrittenCount,
  listDrafts,
  MAX_DRAFTS,
  saveDraft,
  serializeDraft,
  WRITTEN_COUNT_STORAGE_KEY,
} from './letterNotebook';

function makeDraft(overrides: Partial<LetterDraft> = {}): LetterDraft {
  return {
    senderName: 'Ana',
    senderAnonymous: false,
    recipientName: 'Lu',
    title: 'Carta de teste',
    message: 'Olá, segue a carta.',
    signature: 'Ana',
    theme: { ...DEFAULT_THEME },
    fadeEnabled: true,
    readTimeLimitSeconds: 600,
    assets: [{ id: 'asset-1', uploadToken: 'token-1' }],
    sealAssetId: 'asset-1',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('letterNotebook', () => {
  it('serializeDraft remove marcadores de foto e zera assets sem alterar o original', () => {
    const mensagem = 'antes [[foto:00000000-0000-4000-8000-000000000001]] depois [[foto:abc]] fim';
    const draft = makeDraft({ message: mensagem, theme: { ...DEFAULT_THEME, seal: 'custom' } });

    const serializado = serializeDraft(draft);

    expect(serializado.message).toBe('antes  depois  fim');
    expect(serializado.assets).toEqual([]);
    expect(serializado.sealAssetId).toBeNull();
    expect(serializado.theme.seal).toBe('custom');
    expect(draft.message).toBe(mensagem);
    expect(draft.assets).toHaveLength(1);
  });

  it('deserializeDraft descarta formas inválidas e reaplica a sanitização', () => {
    expect(deserializeDraft(null)).toBeNull();
    expect(deserializeDraft({})).toBeNull();
    expect(deserializeDraft({ ...makeDraft(), theme: { ...DEFAULT_THEME, palette: 'invalid' } })).toBeNull();

    expect(
      deserializeDraft({
        ...makeDraft(),
        assets: [{ id: 'asset-1', uploadToken: 'token-1' }],
        sealAssetId: 'asset-1',
        message: '[[foto:asset-1]]Só o texto.',
      }),
    ).toMatchObject({ assets: [], sealAssetId: null, message: 'Só o texto.' });
  });

  it('salva, lista e restaura um rascunho sem fotos nem selo desenhado', () => {
    const salvo = saveDraft(
      makeDraft({
        message: '[[foto:asset-1]]Mensagem que volta.',
        theme: { ...DEFAULT_THEME, seal: 'custom' },
      }),
    );

    expect(salvo.id).toBeTruthy();
    expect(salvo.savedAt).toBeGreaterThan(0);
    expect(salvo.draft.assets).toEqual([]);
    expect(salvo.draft.sealAssetId).toBeNull();

    const rascunhos = listDrafts();
    expect(rascunhos).toHaveLength(1);
    expect(rascunhos[0]).toEqual(salvo);
    expect(rascunhos[0].draft.message).toBe('Mensagem que volta.');
    expect(rascunhos[0].draft.theme.seal).toBe('custom');
  });

  it('mantém no máximo dez rascunhos, do mais recente para o mais antigo', () => {
    for (let indice = 0; indice < 12; indice += 1) {
      saveDraft(makeDraft({ title: `Carta ${indice}` }));
    }

    const rascunhos = listDrafts();
    expect(rascunhos).toHaveLength(MAX_DRAFTS);
    expect(rascunhos[0].draft.title).toBe('Carta 11');
    expect(rascunhos[MAX_DRAFTS - 1].draft.title).toBe('Carta 2');
  });

  it('descarta JSON corrompido e registros inválidos ao listar', () => {
    localStorage.setItem(DRAFTS_STORAGE_KEY, '{quebrado');
    expect(listDrafts()).toEqual([]);

    const valido = saveDraft(makeDraft({ title: 'Válida' }));
    localStorage.setItem(
      DRAFTS_STORAGE_KEY,
      JSON.stringify([
        null,
        'lixo',
        { id: 'sem-data', savedAt: 'agora', draft: makeDraft() },
        { id: 'data-fora-do-intervalo', savedAt: 1e20, draft: makeDraft() },
        {
          id: 'tema-invalido',
          savedAt: 1,
          draft: { ...makeDraft(), theme: { ...DEFAULT_THEME, paper: 'inexistente' } },
        },
        valido,
      ]),
    );

    const rascunhos = listDrafts();
    expect(rascunhos).toHaveLength(1);
    expect(rascunhos[0].draft.title).toBe('Válida');
  });

  it('exclui apenas o rascunho indicado', () => {
    const primeiro = saveDraft(makeDraft({ title: 'Primeira' }));
    saveDraft(makeDraft({ title: 'Segunda' }));

    deleteDraft(primeiro.id);
    expect(listDrafts().map((item) => item.draft.title)).toEqual(['Segunda']);

    deleteDraft('id-inexistente');
    expect(listDrafts()).toHaveLength(1);
  });

  it('devolve erro amigável quando a cota do navegador estoura', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cheio', 'QuotaExceededError');
    });

    expect(() => saveDraft(makeDraft())).toThrow(/armazenamento do navegador está cheio/i);
  });

  it('respeita o teto total de ~2 MB removendo os rascunhos mais antigos', () => {
    const mensagemGrande = 'a'.repeat(900_000);
    saveDraft(makeDraft({ title: 'grande 1', message: mensagemGrande }));
    saveDraft(makeDraft({ title: 'grande 2', message: mensagemGrande }));
    saveDraft(makeDraft({ title: 'grande 3', message: mensagemGrande }));

    const rascunhos = listDrafts();
    expect(rascunhos).toHaveLength(2);
    expect(rascunhos[0].draft.title).toBe('grande 3');

    expect(() =>
      saveDraft(makeDraft({ message: 'a'.repeat(2 * 1024 * 1024) })),
    ).toThrow(/grande demais/i);
  });

  it('conta as cartas por navegador e ignora valores corrompidos', () => {
    expect(getWrittenCount()).toBe(0);
    expect(incrementWrittenCount()).toBe(1);
    expect(incrementWrittenCount()).toBe(2);
    expect(getWrittenCount()).toBe(2);
    expect(JSON.parse(localStorage.getItem(WRITTEN_COUNT_STORAGE_KEY) ?? 'null')).toBe(2);

    localStorage.setItem(WRITTEN_COUNT_STORAGE_KEY, 'quebrado');
    expect(getWrittenCount()).toBe(0);
    localStorage.setItem(WRITTEN_COUNT_STORAGE_KEY, '-3');
    expect(getWrittenCount()).toBe(0);
  });
});
