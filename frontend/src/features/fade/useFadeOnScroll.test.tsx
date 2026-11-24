import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { useFadeOnScroll } from './useFadeOnScroll';

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly observed = new Set<Element>();

  constructor(
    readonly callback: IntersectionObserverCallback,
    _options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(target: Element, isIntersecting: boolean): void {
    const entry = {
      target,
      isIntersecting,
      intersectionRatio: isIntersecting ? 1 : 0,
    } as unknown as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
}

interface Harness {
  scroller: HTMLDivElement;
  sheet: HTMLElement;
  sentinel: HTMLElement;
  blocks: HTMLElement[];
  setScrollTop(top: number): void;
}

let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;

function flushFrames(): void {
  act(() => {
    const pending = Array.from(frames.values());
    frames.clear();
    for (const callback of pending) callback(Date.now());
  });
}

function mountDom(paragraphs: string[]): Harness {
  const scroller = document.createElement('div');
  scroller.className = 'letter-scroll';

  const sheet = document.createElement('article');
  sheet.setAttribute('data-letter-sheet', 'true');

  const blocks = paragraphs.map((text) => {
    const paragraph = document.createElement('p');
    paragraph.setAttribute('data-letter-block', 'true');
    paragraph.textContent = text;
    sheet.appendChild(paragraph);
    return paragraph;
  });

  const sentinel = document.createElement('div');
  sentinel.setAttribute('data-reading-sentinel', 'true');
  scroller.append(sheet, sentinel);
  document.body.appendChild(scroller);

  let scrollTop = 0;

  const rect = (top: number, height: number): DOMRect =>
    ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  const defineRect = (element: Element, getTop: () => number, height: number): void => {
    Object.defineProperty(element, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(getTop(), height),
    });
  };

  // Scroller de 1000px: linha em y=700 e zona de transição de 150px.
  defineRect(scroller, () => 0, 1000);
  // O segundo bloco começa abaixo da linha (bottom 750 > 700) e não inicia dwell.
  blocks.forEach((block, index) => defineRect(block, () => 400 + index * 250 - scrollTop, 100));
  defineRect(sentinel, () => 400 + paragraphs.length * 250 - scrollTop, 40);

  return {
    scroller,
    sheet,
    sentinel,
    blocks,
    setScrollTop(top: number): void {
      scrollTop = top;
    },
  };
}

function renderFade(
  dom: Harness,
  overrides: Partial<Parameters<typeof useFadeOnScroll>[0]> = {},
): { onProgress: Mock<(progress: number) => void>; onComplete: Mock<() => void> } {
  const scrollerRef: RefObject<HTMLDivElement | null> = { current: dom.scroller };
  const sheetRef: RefObject<HTMLElement | null> = { current: dom.sheet };
  const onProgress = vi.fn<(progress: number) => void>();
  const onComplete = vi.fn<() => void>();

  renderHook(() =>
    useFadeOnScroll({
      scrollerRef,
      sheetRef,
      enabled: true,
      sessionId: 'sessao-1',
      savedProgress: 0,
      onProgress,
      onComplete,
      ...overrides,
    }),
  );

  return { onProgress, onComplete };
}

function observer(): FakeIntersectionObserver {
  const instance = FakeIntersectionObserver.instances[0];
  expect(instance).toBeDefined();
  return instance;
}

beforeEach(() => {
  vi.useFakeTimers();
  frames = new Map();
  nextFrameId = 1;

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    const id = nextFrameId;
    nextFrameId += 1;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    frames.delete(id);
  });
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  FakeIntersectionObserver.instances = [];

  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('useFadeOnScroll', () => {
  it('reporta o primeiro avanço sem aguardar o heartbeat de 1500 ms', () => {
    const dom = mountDom(['alpha beta', 'gamma delta']);
    const { onProgress } = renderFade(dom);

    act(() => observer().emit(dom.sheet, true));
    flushFrames();

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(0.5);
  });

  it('não apaga o bloco antes de concluído o dwell', () => {
    const dom = mountDom(['primeiro bloco', 'segundo bloco']);
    renderFade(dom);

    act(() => observer().emit(dom.sheet, true));
    flushFrames();

    expect(dom.blocks[0].textContent).toBe('primeiro bloco');

    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(dom.blocks[0].textContent).toBe('primeiro bloco');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(dom.blocks[0].textContent).toBe('');
    expect(dom.blocks[0].dataset.faded).toBe('true');
  });

  it('cancela o dwell quando o bloco volta para baixo da linha', () => {
    const dom = mountDom(['palavras que ficam']);
    renderFade(dom);

    act(() => observer().emit(dom.sheet, true));
    flushFrames();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    dom.setScrollTop(-300);
    act(() => {
      dom.scroller.dispatchEvent(new Event('scroll'));
    });
    flushFrames();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(dom.blocks[0].textContent).toBe('palavras que ficam');
  });

  it('mantém o progresso monotônico quando o usuário rola de volta', () => {
    const dom = mountDom(['alpha beta', 'gamma delta']);
    const { onProgress } = renderFade(dom);

    act(() => observer().emit(dom.sheet, true));
    flushFrames();

    expect(dom.blocks[0].style.getPropertyValue('--read-progress')).toBe('1.000');

    act(() => {
      vi.advanceTimersByTime(1500);
      dom.scroller.dispatchEvent(new Event('scroll'));
    });
    flushFrames();

    dom.setScrollTop(-200);
    act(() => {
      vi.advanceTimersByTime(1500);
      dom.scroller.dispatchEvent(new Event('scroll'));
    });
    flushFrames();

    expect(dom.blocks[0].style.getPropertyValue('--read-progress')).toBe('1.000');
    const values = onProgress.mock.calls.map((call) => call[0]);
    expect(values).toEqual([0.5]);
  });

  it('conclui uma única vez após a permanência contínua da sentinela', () => {
    const dom = mountDom(['um dois tres']);
    const { onComplete } = renderFade(dom);

    act(() => {
      dom.setScrollTop(200);
      observer().emit(dom.sheet, true);
      observer().emit(dom.sentinel, true);
    });
    flushFrames();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    flushFrames();

    expect(onComplete).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5000);
      dom.scroller.dispatchEvent(new Event('scroll'));
    });
    flushFrames();

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('já apaga os blocos lidos quando há progresso salvo', () => {
    const dom = mountDom(['aaa bbb', 'ccc ddd', 'eee fff']);
    renderFade(dom, { savedProgress: 0.8 });

    expect(dom.blocks[0].textContent).toBe('');
    expect(dom.blocks[0].dataset.faded).toBe('true');
    expect(dom.blocks[0].style.getPropertyValue('--read-progress')).toBe('1.000');
    expect(dom.blocks[1].textContent).toBe('');
    expect(dom.blocks[2].textContent).toBe('eee fff');
    expect(dom.blocks[2].style.getPropertyValue('--read-progress')).toBe('0.400');
  });
});
