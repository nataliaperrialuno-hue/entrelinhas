import { describe, expect, it } from 'vitest';
import { insertToken, wrapSelection } from './richTextEditing';

describe('wrapSelection', () => {
  it('envolve o trecho selecionado e mantém o texto interno selecionado', () => {
    const result = wrapSelection('Olá mundo', 0, 3, '**', '**', 'negrito');

    expect(result).toEqual({
      value: '**Olá** mundo',
      selectionStart: 2,
      selectionEnd: 5,
    });
  });

  it('insere um placeholder selecionado quando não há seleção', () => {
    const result = wrapSelection('Olá', 3, 3, '[[cor:#ff0000]]', '[[/cor]]', 'texto colorido');

    expect(result.value).toBe('Olá[[cor:#ff0000]]texto colorido[[/cor]]');
    expect(result.selectionStart).toBe('Olá[[cor:#ff0000]]'.length);
    expect(result.selectionEnd).toBe(result.selectionStart + 'texto colorido'.length);
  });

  it('desfaz os marcadores quando o trecho já está envolvido', () => {
    const result = wrapSelection('**Olá** mundo', 2, 5, '**', '**', 'negrito');

    expect(result).toEqual({
      value: 'Olá mundo',
      selectionStart: 0,
      selectionEnd: 3,
    });
  });

  it('não desfaz marcadores de outro tipo', () => {
    const result = wrapSelection('**Olá** mundo', 2, 5, '__', '__', 'sublinhado');

    expect(result.value).toBe('**__Olá__** mundo');
  });

  it('normaliza índices fora do intervalo sem gerar texto inesperado', () => {
    const result = wrapSelection('abc', -10, 999, '*', '*', 'itálico');

    expect(result.value).toBe('*abc*');
    expect(result.selectionStart).toBe(1);
    expect(result.selectionEnd).toBe(4);
  });
});

describe('insertToken', () => {
  it('insere o token no caret e deixa o cursor logo após ele', () => {
    const result = insertToken('Olá mundo', 4, 4, '[[foto:abc]]');

    expect(result).toEqual({
      value: 'Olá [[foto:abc]]mundo',
      selectionStart: 4 + '[[foto:abc]]'.length,
      selectionEnd: 4 + '[[foto:abc]]'.length,
    });
  });

  it('substitui a seleção ao inserir o token', () => {
    const result = insertToken('Olá mundo', 4, 9, '[[foto:abc]]');

    expect(result.value).toBe('Olá [[foto:abc]]');
    expect(result.selectionStart).toBe(result.value.length);
    expect(result.selectionEnd).toBe(result.value.length);
  });

  it('normaliza índices invertidos e fora do intervalo', () => {
    const result = insertToken('abc', 999, -5, 'T');

    expect(result).toEqual({ value: 'abcT', selectionStart: 4, selectionEnd: 4 });
  });
});
