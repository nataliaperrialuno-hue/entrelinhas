/**
 * Converte o formato de texto rico persistido como texto puro no banco em
 * ReactNode. Nenhum HTML é produzido: apenas strings e elementos React, para
 * que o React continue escapando `<`/`>` e o hook de fade possa ler e limpar
 * `element.textContent` normalmente.
 */

import { createElement } from 'react';
import type { ReactNode } from 'react';

type MarkerType = 'strong' | 'em' | 'u' | 'mark' | 'cor' | 'fonte' | 'tamanho';

interface TextNode {
  kind: 'text';
  text: string;
}

interface ElementNode {
  kind: 'element';
  type: MarkerType;
  openToken: string;
  closeToken: string;
  value?: string;
  children: ParsedNode[];
  closed: boolean;
}

interface RootNode {
  kind: 'root';
  children: ParsedNode[];
}

type ParsedNode = TextNode | ElementNode;
type ContainerNode = RootNode | ElementNode;

interface TokenMatch {
  type: MarkerType;
  token: string;
  closeToken: string;
  value?: string;
  /** O mesmo delimitador serve como abertura e fechamento (ex.: `**`). */
  ambiguous: boolean;
  /** Token que apenas fecha, como `[[/cor]]`. */
  closeOnly: boolean;
}

interface ParameterMarker {
  prefix: string;
  type: 'cor' | 'fonte' | 'tamanho';
  close: string;
  valid: RegExp;
  lowercase: boolean;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const FONT_ID = /^(serif|hand|mono)$/;
const SIZE_ID = /^(sm|md|lg)$/;

const PARAMETER_MARKERS: readonly ParameterMarker[] = [
  { prefix: '[[cor:', type: 'cor', close: '[[/cor]]', valid: HEX_COLOR, lowercase: true },
  { prefix: '[[fonte:', type: 'fonte', close: '[[/fonte]]', valid: FONT_ID, lowercase: false },
  { prefix: '[[tamanho:', type: 'tamanho', close: '[[/tamanho]]', valid: SIZE_ID, lowercase: false },
];

function simpleMarker(type: MarkerType, token: string): TokenMatch {
  return { type, token, closeToken: token, ambiguous: true, closeOnly: false };
}

/**
 * Reconstrói a forma literal de um nó. O `closeToken` só entra quando o par
 * realmente foi fechado, para não inventar delimitadores inexistentes.
 */
function toLiteral(node: ParsedNode): string {
  if (node.kind === 'text') return node.text;
  const inner = node.children.map(toLiteral).join('');
  return node.openToken + inner + (node.closed ? node.closeToken : '');
}

function toReact(node: ParsedNode, key: string): ReactNode {
  if (node.kind === 'text') return node.text;

  const children = node.children.map((child, index) => toReact(child, `${key}.${index}`));

  switch (node.type) {
    case 'strong':
      return createElement('strong', { key }, children);
    case 'em':
      return createElement('em', { key }, children);
    case 'u':
      return createElement('u', { key }, children);
    case 'mark':
      return createElement('mark', { key }, children);
    case 'cor':
      return createElement('span', { key, style: { color: node.value ?? '' } }, children);
    case 'fonte':
      return createElement('span', { key, className: `rt-font-${node.value ?? ''}` }, children);
    case 'tamanho':
      return createElement('span', { key, className: `rt-size-${node.value ?? ''}` }, children);
  }
}

/**
 * Renderiza `**negrito**`, `*itálico*`, `__sublinhado__`, `==destaque==`,
 * `[[cor:#RRGGBB]]`, `[[fonte:id]]` e `[[tamanho:id]]` como elementos React.
 *
 * Valores fora da whitelist e marcadores sem fechamento ou com aninhamento
 * cruzado permanecem como texto literal, sem lançar e sem perder caracteres.
 * Quebras de linha são preservadas como texto.
 */
export function renderRichText(text: string): ReactNode {
  // Se `]]` não existe a partir de uma posição, não existe depois dela. Esse
  // cursor impede varreduras repetidas e mantém o parser próximo de O(n).
  let noBracketCloseFrom = text.length;

  function findBracketEnd(start: number): number {
    if (start >= noBracketCloseFrom) return -1;
    const found = text.indexOf(']]', start);
    if (found === -1) noBracketCloseFrom = start;
    return found;
  }

  function matchToken(index: number): TokenMatch | null {
    if (text.startsWith('[[', index)) {
      if (text.startsWith('[[/cor]]', index)) {
        return {
          type: 'cor',
          token: '[[/cor]]',
          closeToken: '[[/cor]]',
          ambiguous: false,
          closeOnly: true,
        };
      }
      if (text.startsWith('[[/fonte]]', index)) {
        return {
          type: 'fonte',
          token: '[[/fonte]]',
          closeToken: '[[/fonte]]',
          ambiguous: false,
          closeOnly: true,
        };
      }
      if (text.startsWith('[[/tamanho]]', index)) {
        return {
          type: 'tamanho',
          token: '[[/tamanho]]',
          closeToken: '[[/tamanho]]',
          ambiguous: false,
          closeOnly: true,
        };
      }

      for (const marker of PARAMETER_MARKERS) {
        if (!text.startsWith(marker.prefix, index)) continue;
        const end = findBracketEnd(index + marker.prefix.length);
        if (end === -1) return null;
        const raw = text.slice(index + marker.prefix.length, end);
        if (!marker.valid.test(raw)) return null;
        return {
          type: marker.type,
          token: text.slice(index, end + 2),
          closeToken: marker.close,
          value: marker.lowercase ? raw.toLowerCase() : raw,
          ambiguous: false,
          closeOnly: false,
        };
      }
      return null;
    }

    // Ordem importa: `**` precisa ser reconhecido antes de `*`.
    if (text.startsWith('**', index)) return simpleMarker('strong', '**');
    if (text.startsWith('__', index)) return simpleMarker('u', '__');
    if (text.startsWith('==', index)) return simpleMarker('mark', '==');
    if (text.startsWith('*', index)) return simpleMarker('em', '*');
    return null;
  }

  const root: RootNode = { kind: 'root', children: [] };
  const stack: ContainerNode[] = [root];
  let pending = '';

  function flush(): void {
    if (pending.length === 0) return;
    stack[stack.length - 1].children.push({ kind: 'text', text: pending });
    pending = '';
  }

  let index = 0;
  while (index < text.length) {
    const match = matchToken(index);
    if (match === null) {
      pending += text[index];
      index += 1;
      continue;
    }

    const top = stack[stack.length - 1];
    const closesTop =
      top.kind === 'element' && top.type === match.type && (match.ambiguous || match.closeOnly);

    if (closesTop) {
      flush();
      // `closesTop` já garantiu que o topo é um ElementNode; a raiz nunca é fechada.
      const frame = stack.pop() as ElementNode;
      frame.closed = true;
      stack[stack.length - 1].children.push(frame);
      index += match.token.length;
      continue;
    }

    if (match.closeOnly) {
      pending += match.token;
      index += match.token.length;
      continue;
    }

    flush();
    stack.push({
      kind: 'element',
      type: match.type,
      openToken: match.token,
      closeToken: match.closeToken,
      value: match.value,
      children: [],
      closed: false,
    });
    index += match.token.length;
  }

  flush();

  // Frames ainda abertos (sem fechamento ou com cruzamento) voltam a ser texto
  // literal na posição em que estavam, preservando o conteúdo integral.
  while (stack.length > 1) {
    // A raiz permanece na pilha, logo o frame removido é sempre um ElementNode.
    const frame = stack.pop() as ElementNode;
    stack[stack.length - 1].children.push({ kind: 'text', text: toLiteral(frame) });
  }

  const nodes = root.children.map((child, position) => toReact(child, String(position)));
  return nodes.length === 1 ? nodes[0] : nodes;
}
