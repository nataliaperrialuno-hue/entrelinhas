/**
 * Converte o formato de texto rico persistido como texto puro no banco em
 * ReactNode. Nenhum HTML é produzido: apenas strings e elementos React, para
 * que o React continue escapando `<`/`>` e o hook de fade possa ler e limpar
 * `element.textContent` normalmente.
 *
 * O marcador de foto é VOID: `[[foto:<uuid-v4>]]`. Ele nunca carrega uma URL —
 * a URL vem exclusivamente de `resolveAsset`, fornecido pelo chamador.
 */

import { createElement } from 'react';
import type { ReactNode } from 'react';

type MarkerType = 'strong' | 'em' | 'u' | 'mark' | 'cor' | 'fonte' | 'tamanho';

interface TextNode {
  kind: 'text';
  text: string;
}

interface ImageNode {
  kind: 'image';
  type: 'foto';
  id: string;
  token: string;
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

type ParsedNode = TextNode | ImageNode | ElementNode;
type ContainerNode = RootNode | ElementNode;

export interface RichTextRenderOptions {
  /** Resolve o id do marcador para uma URL segura; `null` literaliza o marcador. */
  resolveAsset?: (id: string) => string | null;
}

interface TokenMatch {
  type: MarkerType | 'foto';
  token: string;
  closeToken: string;
  value?: string;
  /** O mesmo delimitador serve como abertura e fechamento (ex.: `**`). */
  ambiguous: boolean;
  /** Token que apenas fecha, como `[[/cor]]`. */
  closeOnly: boolean;
  /** Marcador void não entra na pilha de aninhamento. */
  void?: boolean;
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
/** UUID v4 canônico: versão 4 no terceiro grupo e variant 8/9/a/b no quarto. */
const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHOTO_PREFIX = '[[foto:';

/**
 * Defesa em profundidade: mesmo que um `resolveAsset` mal implementado devolva
 * algo perigoso, apenas caminhos internos de asset e object URLs são aceitos.
 * Nunca há URL no texto do usuário.
 */
function isSafeAssetUrl(url: string | null | undefined): url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return false;
  if (/\s/.test(url) || url.includes('\\')) return false;
  for (let index = 0; index < url.length; index += 1) {
    const code = url.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  if (url.startsWith('//')) return false;
  if (url.startsWith('/api/assets/')) {
    const rest = url.slice('/api/assets/'.length);
    return rest.length > 0 && !rest.includes('/') && !rest.includes('?') && !rest.includes('#');
  }
  return url.startsWith('blob:') && url.length > 'blob:'.length;
}

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
  if (node.kind === 'image') return node.token;
  const inner = node.children.map(toLiteral).join('');
  return node.openToken + inner + (node.closed ? node.closeToken : '');
}

function toReact(
  node: ParsedNode,
  key: string,
  resolveAsset: RichTextRenderOptions['resolveAsset'],
): ReactNode {
  if (node.kind === 'text') return node.text;

  if (node.kind === 'image') {
    const src = resolveAsset?.(node.id);
    if (!isSafeAssetUrl(src)) return node.token;
    return createElement('img', {
      key,
      src,
      alt: 'Foto da carta',
      className: 'letter-photo',
      loading: 'lazy',
      decoding: 'async',
      draggable: false,
    });
  }

  const children = node.children.map((child, index) => toReact(child, `${key}.${index}`, resolveAsset));

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
 * `[[cor:#RRGGBB]]`, `[[fonte:id]]`, `[[tamanho:id]]` e `[[foto:<uuid>]]`
 * como elementos React.
 *
 * Valores fora da whitelist, marcadores sem fechamento, aninhamento cruzado e
 * fotos cujo id não pode ser resolvido permanecem como texto literal, sem
 * lançar e sem perder caracteres. Quebras de linha são preservadas como texto.
 */
export function renderRichText(text: string, options: RichTextRenderOptions = {}): ReactNode {
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

      if (text.startsWith(PHOTO_PREFIX, index)) {
        const end = findBracketEnd(index + PHOTO_PREFIX.length);
        if (end === -1) return null;
        const id = text.slice(index + PHOTO_PREFIX.length, end);
        if (!PHOTO_ID.test(id)) return null;
        return {
          type: 'foto',
          token: text.slice(index, end + 2),
          closeToken: '',
          value: id,
          ambiguous: false,
          closeOnly: false,
          void: true,
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

    if (match.void) {
      flush();
      stack[stack.length - 1].children.push({
        kind: 'image',
        type: 'foto',
        id: match.value as string,
        token: match.token,
      });
      index += match.token.length;
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
      type: match.type as MarkerType,
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

  const nodes = root.children.map((child, position) =>
    toReact(child, String(position), options.resolveAsset),
  );
  return nodes.length === 1 ? nodes[0] : nodes;
}
