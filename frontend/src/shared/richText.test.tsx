import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRichText } from './richText';

function mount(text: string) {
  return render(<p data-letter-block="true">{renderRichText(text)}</p>).container;
}

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
});
