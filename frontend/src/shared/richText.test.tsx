import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRichText } from './richText';

function mount(text: string, resolveAsset?: (id: string) => string | null) {
  return render(<p data-letter-block="true">{renderRichText(text, { resolveAsset })}</p>).container;
}

const PHOTO_ID = '11111111-1111-4111-8111-111111111111';
const PHOTO_TOKEN = `[[foto:${PHOTO_ID}]]`;
const PHOTO_URL = `/api/assets/${PHOTO_ID}`;

describe('renderRichText', () => {
  it('converte marcadores simples em elementos semânticos', () => {
    const container = mount('**negrito** *itálico* __sublinhado__ ==destaque==');

    expect(container.querySelector('strong')).toHaveTextContent('negrito');
    expect(container.querySelector('em')).toHaveTextContent('itálico');
    expect(container.querySelector('u')).toHaveTextContent('sublinhado');
    expect(container.querySelector('mark')).toHaveTextContent('destaque');
    expect(container.textContent).toBe('negrito itálico sublinhado destaque');
  });

  it('aplica uma cor válida normalizada para minúsculas', () => {
    const container = mount('[[cor:#FF00Aa]]colorido[[/cor]]');
    const span = container.querySelector('span');

    expect(span).not.toBeNull();
    expect(span).toHaveStyle({ color: '#ff00aa' });
    expect(span).toHaveTextContent('colorido');
  });

  it.each(['#fff', 'red', '#12345g', ''])('mantém a cor inválida (%j) como texto literal', (value) => {
    const source = `[[cor:${value}]]trecho[[/cor]]`;
    const container = mount(source);

    expect(container.querySelector('span')).toBeNull();
    expect(container.textContent).toBe(source);
  });

  it.each(['serif', 'hand', 'mono'])('aplica a fonte válida %s', (id) => {
    const container = mount(`[[fonte:${id}]]texto[[/fonte]]`);
    const span = container.querySelector('span');

    expect(span?.className).toBe(`rt-font-${id}`);
    expect(span).toHaveTextContent('texto');
  });

  it.each(['sm', 'md', 'lg'])('aplica o tamanho válido %s', (id) => {
    const container = mount(`[[tamanho:${id}]]texto[[/tamanho]]`);
    const span = container.querySelector('span');

    expect(span?.className).toBe(`rt-size-${id}`);
    expect(span).toHaveTextContent('texto');
  });

  it.each([
    ['fonte', 'script'],
    ['tamanho', 'xl'],
    ['fonte', ''],
    ['tamanho', ''],
  ])('mantém %s inválido (%j) como texto literal', (kind, value) => {
    const source = `[[${kind}:${value}]]texto[[/${kind}]]`;
    const container = mount(source);

    expect(container.querySelector('span')).toBeNull();
    expect(container.textContent).toBe(source);
  });

  it('suporta aninhamento correto de marcadores', () => {
    const container = mount('**com [[cor:#ff0000]]vermelho[[/cor]] forte**');
    const strong = container.querySelector('strong');

    expect(strong).not.toBeNull();
    expect(strong?.querySelector('span')).toHaveStyle({ color: '#ff0000' });
    expect(strong?.textContent).toBe('com vermelho forte');
  });

  it('mantém um marcador sem fechamento como texto literal', () => {
    const source = '**sem fechamento aqui';
    const container = mount(source);

    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toBe(source);
  });

  it('desfaz um marcador aberto sem fechamento mesmo com filhos válidos', () => {
    const source = '**aberto e *itálico* fechado';
    const container = mount(source);

    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('em')).toBeNull();
    expect(container.textContent).toBe(source);
  });

  it('preserva o marcador válido e literaliza apenas o trecho sem fechamento', () => {
    const container = mount('texto **válido** e **inválido');

    expect(container.querySelector('strong')).toHaveTextContent('válido');
    expect(container.textContent).toBe('texto válido e **inválido');
  });

  it('renderiza aninhamento cruzado como texto literal sem perder caracteres', () => {
    const source = '**a *b** c*';
    const container = mount(source);

    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('em')).toBeNull();
    expect(container.textContent).toBe(source);
  });

  it('mantém HTML do usuário como texto, sem criar elemento script', () => {
    const source = '<script>alert(1)</script>';
    const container = mount(source);

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toBe(source);
    expect(screen.getByText(source)).toBeInTheDocument();
  });

  it('devolve texto comum integralmente, preservando quebras de linha', () => {
    const source = ' primeira linha\nsegunda linha ';
    const container = mount(source);

    expect(container.textContent).toBe(source);
  });

  it('processa 100k caracteres com marcadores sem perder conteúdo', () => {
    const source = `${'a'.repeat(50_000)}**b**${'c'.repeat(50_000)}`;
    const container = mount(source);

    expect(container.querySelector('strong')).toHaveTextContent('b');
    expect(container.textContent).toBe(`${'a'.repeat(50_000)}b${'c'.repeat(50_000)}`);
  });

  it('não degrada com milhares de aberturas de cor sem fechamento', () => {
    const source = '[[cor:#12345'.repeat(10_000);
    const container = mount(source);

    expect(container.querySelector('span')).toBeNull();
    expect(container.textContent).toBe(source);
  });

  it('renderiza um marcador de foto válido como img dentro do parágrafo', () => {
    const container = mount(`olá ${PHOTO_TOKEN} mundo`, () => PHOTO_URL);
    const image = container.querySelector('img');

    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toBe(PHOTO_URL);
    expect(image).toHaveAttribute('alt', 'Foto da carta');
    expect(image).toHaveAttribute('class', 'letter-photo');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('decoding', 'async');
    expect(image).toHaveAttribute('draggable', 'false');
    expect(container.querySelector('p')?.contains(image as Node)).toBe(true);
  });

  it('aceita object URLs para prévia imediata', () => {
    const previewUrl = 'blob:http://localhost/1234';
    const container = mount(PHOTO_TOKEN, () => previewUrl);

    expect(container.querySelector('img')).toHaveAttribute('src', previewUrl);
  });

  it('mantém o marcador como texto sem resolvedor ou quando ele retorna null', () => {
    const withoutResolver = mount(PHOTO_TOKEN);
    const withNull = mount(PHOTO_TOKEN, () => null);

    expect(withoutResolver.querySelector('img')).toBeNull();
    expect(withoutResolver.textContent).toBe(PHOTO_TOKEN);
    expect(withNull.querySelector('img')).toBeNull();
    expect(withNull.textContent).toBe(PHOTO_TOKEN);
  });

  it.each([
    'foto',
    'abc',
    '11111111-1111-1111-8111-111111111111',
    '11111111-1111-4111-c111-111111111111',
    `${PHOTO_ID} extra`,
  ])('mantém o valor inválido %j como texto literal', (value) => {
    const source = `[[foto:${value}]]`;
    const container = mount(source, () => PHOTO_URL);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe(source);
  });

  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml,<svg onload=alert(1)>',
    '../../segredo',
    '//evil.example/x',
    'https://evil.example/x',
    '/outro-caminho/x',
  ])('rejeita URL insegura do resolvedor (%j)', (url) => {
    const container = mount(PHOTO_TOKEN, () => url);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe(PHOTO_TOKEN);
  });

  it('não captura ]] extras e preserva o excedente como texto', () => {
    const container = mount(`${PHOTO_TOKEN}]`, () => PHOTO_URL);

    expect(container.querySelector('img')).not.toBeNull();
    expect(container.textContent).toBe(']');
  });

  it('renderiza fotos aninhadas em marcadores válidos', () => {
    const container = mount(`**com ${PHOTO_TOKEN} dentro**`, () => PHOTO_URL);
    const strong = container.querySelector('strong');

    expect(strong).not.toBeNull();
    expect(strong?.querySelector('img')).not.toBeNull();
    expect(strong?.textContent).not.toContain('[[foto:');
  });

  it('processa 100k caracteres com uma foto sem perder conteúdo', () => {
    const source = `${'a'.repeat(50_000)}${PHOTO_TOKEN}${'c'.repeat(50_000)}`;
    const container = mount(source, () => PHOTO_URL);

    expect(container.querySelector('img')).not.toBeNull();
    expect(container.textContent).toBe(`${'a'.repeat(50_000)}${'c'.repeat(50_000)}`);
  });
});
