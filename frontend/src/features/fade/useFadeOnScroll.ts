import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { blockProgress, clamp, dwellForWords, mergeProgress, shouldComplete } from './readingLine';

const READING_LINE_RATIO = 0.7;
const FADE_SPAN_RATIO = 0.15;
const HEARTBEAT_MS = 1500;
const COMPLETION_DWELL_MS = 1000;
const BLOCK_SELECTOR = '[data-letter-block]';
const SENTINEL_SELECTOR = '[data-reading-sentinel]';

export interface UseFadeOnScrollOptions {
  scrollerRef: RefObject<HTMLDivElement | null>;
  sheetRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  sessionId: string;
  savedProgress: number;
  onProgress: (progress: number) => void;
  onComplete: () => void;
}

function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  return Math.max(1, words.length);
}

function isAdvancePaused(): boolean {
  if (document.visibilityState !== 'visible') return true;

  const selection = window.getSelection();
  if (selection !== null && !selection.isCollapsed) return true;

  const active = document.activeElement;
  return active instanceof Element && active.closest(BLOCK_SELECTOR) !== null;
}

/**
 * Acompanha a leitura sem provocar renders por frame: o CSS reage à variável
 * `--read-progress` escrita diretamente em cada bloco. O IntersectionObserver
 * funciona apenas como gate de atividade; toda a geometria vem de
 * `getBoundingClientRect`.
 */
export function useFadeOnScroll({
  scrollerRef,
  sheetRef,
  enabled,
  sessionId,
  savedProgress,
  onProgress,
  onComplete,
}: UseFadeOnScrollOptions): void {
  const maxSeenRef = useRef(clamp(savedProgress));
  const completedRef = useRef(false);
  const onProgressRef = useRef(onProgress);
  const onCompleteRef = useRef(onComplete);

  onProgressRef.current = onProgress;
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!enabled) return;

    const scroller = scrollerRef.current;
    const sheet = sheetRef.current;
    if (scroller === null || sheet === null) return;

    // Aliases com tipo não-nulo: rAF, timers e observers leem estes valores depois do guard.
    const scrollerElement: HTMLDivElement = scroller;
    const sheetElement: HTMLElement = sheet;

    maxSeenRef.current = mergeProgress(maxSeenRef.current, clamp(savedProgress));

    const blocks = Array.from(sheetElement.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
    const sentinel = scrollerElement.querySelector<HTMLElement>(SENTINEL_SELECTOR);

    // Estado por ciclo de observação: o texto original nunca é escrito no DOM.
    const originalText = new WeakMap<Element, string>();
    const originalHeight = new WeakMap<Element, number>();
    const blockSeen = new WeakMap<Element, number>();
    const dwellTimers = new Map<Element, ReturnType<typeof setTimeout>>();

    let frameId: number | null = null;
    let frameUsesTimeout = false;
    let gateActive = true;
    let sentinelVisible = false;
    let lastBlockSeen = 0;
    let lastSentProgress = maxSeenRef.current;
    // O primeiro avanço deve ser reportado imediatamente; o throttle de 1500 ms vale só para os seguintes.
    let lastSentAt = 0;
    let completionTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function eraseBlock(element: HTMLElement): void {
      if (element.dataset.faded === 'true') return;
      if (element.style.minHeight.length === 0) {
        element.style.minHeight = `${Math.round(originalHeight.get(element) ?? 0)}px`;
      }
      element.style.setProperty('--read-progress', '1.000');
      element.textContent = '';
      element.dataset.faded = 'true';
      blockSeen.set(element, 1);
    }

    // Restauração imediata: um reload nunca devolve texto já lido.
    for (const [index, element] of blocks.entries()) {
      originalText.set(element, element.textContent ?? '');
      originalHeight.set(element, element.getBoundingClientRect().height);
      const restored = clamp(maxSeenRef.current * blocks.length - index);
      blockSeen.set(element, restored);
      element.style.setProperty('--read-progress', restored.toFixed(3));
      if (restored >= 1) eraseBlock(element);
    }

    const lastBlock = blocks.at(-1);
    lastBlockSeen = lastBlock !== undefined ? (blockSeen.get(lastBlock) ?? 0) : 0;

    function cancelFrame(): void {
      if (frameId === null) return;
      if (frameUsesTimeout) window.clearTimeout(frameId);
      else window.cancelAnimationFrame(frameId);
      frameId = null;
    }

    function cancelCompletion(): void {
      if (completionTimer === null) return;
      clearTimeout(completionTimer);
      completionTimer = null;
    }

    function finish(): void {
      if (disposed || completedRef.current) return;
      const canFinish = shouldComplete({
        globalProgress: maxSeenRef.current,
        lastBlockProgress: lastBlockSeen,
        sentinelVisible,
        dwellMs: COMPLETION_DWELL_MS,
        requiredDwellMs: COMPLETION_DWELL_MS,
      });
      if (!canFinish || isAdvancePaused()) return;
      completedRef.current = true;
      onCompleteRef.current();
    }

    function scheduleFrame(): void {
      if (disposed || !gateActive || frameId !== null) return;

      frameUsesTimeout = typeof window.requestAnimationFrame !== 'function';
      const run = (): void => {
        frameId = null;
        measure();
      };

      frameId = frameUsesTimeout ? window.setTimeout(run, 16) : window.requestAnimationFrame(run);
    }

    function measure(): void {
      if (disposed || !gateActive) return;

      const scrollerRect = scrollerElement.getBoundingClientRect();
      const lineY = scrollerRect.top + scrollerRect.height * READING_LINE_RATIO;
      const fadeSpan = Math.max(1, scrollerRect.height * FADE_SPAN_RATIO);
      const paused = isAdvancePaused();
      let total = 0;

      for (const element of blocks) {
        const previous = blockSeen.get(element) ?? 0;
        const rect = element.getBoundingClientRect();

        // Rolar para cima cancela a contagem de permanência daquele bloco.
        const timer = dwellTimers.get(element);
        if (rect.bottom > lineY && timer !== undefined) {
          clearTimeout(timer);
          dwellTimers.delete(element);
        }

        if (element.dataset.faded === 'true') {
          total += 1;
          continue;
        }

        if (paused) {
          total += previous;
          continue;
        }

        const next = mergeProgress(previous, blockProgress(lineY, fadeSpan, rect.bottom));
        blockSeen.set(element, next);
        element.style.setProperty('--read-progress', next.toFixed(3));
        total += next;

        if (rect.bottom <= lineY && !dwellTimers.has(element)) {
          const dwellMs = dwellForWords(countWords(originalText.get(element) ?? element.textContent ?? ''));
          const dwellTimer = setTimeout(() => {
            dwellTimers.delete(element);
            if (disposed || element.dataset.faded === 'true') return;

            const currentRect = scrollerElement.getBoundingClientRect();
            const currentLineY = currentRect.top + currentRect.height * READING_LINE_RATIO;
            if (element.getBoundingClientRect().bottom > currentLineY) return;

            eraseBlock(element);
            scheduleFrame();
          }, dwellMs);
          dwellTimers.set(element, dwellTimer);
        }
      }

      const candidate = blocks.length > 0 ? total / blocks.length : 0;
      maxSeenRef.current = mergeProgress(maxSeenRef.current, clamp(candidate));

      if (!paused) {
        const now = Date.now();
        if (maxSeenRef.current > lastSentProgress && now - lastSentAt >= HEARTBEAT_MS) {
          lastSentProgress = maxSeenRef.current;
          lastSentAt = now;
          onProgressRef.current(maxSeenRef.current);
        }
      }

      lastBlockSeen = lastBlock !== undefined ? (blockSeen.get(lastBlock) ?? 0) : 0;
      const ready =
        !paused &&
        sentinelVisible &&
        maxSeenRef.current >= 0.98 &&
        lastBlockSeen >= 0.95;

      if (ready && !completedRef.current) {
        if (completionTimer === null) {
          completionTimer = setTimeout(() => {
            completionTimer = null;
            finish();
          }, COMPLETION_DWELL_MS);
        }
      } else {
        cancelCompletion();
      }
    }

    function handleVisibility(): void {
      if (document.visibilityState === 'hidden') {
        if (typeof navigator.sendBeacon === 'function') {
          navigator.sendBeacon(
            `/api/read/${encodeURIComponent(sessionId)}/progress`,
            new Blob([JSON.stringify({ progress: maxSeenRef.current })], {
              type: 'application/json',
            }),
          );
        }
        cancelFrame();
        return;
      }
      scheduleFrame();
    }

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.target === sheetElement) gateActive = entry.isIntersecting;
            if (sentinel !== null && entry.target === sentinel) {
              sentinelVisible = entry.isIntersecting && entry.intersectionRatio > 0;
            }
          }
          if (gateActive) scheduleFrame();
          else {
            cancelFrame();
            cancelCompletion();
          }
        },
        {
          root: scrollerElement,
          rootMargin: '0px 0px -30% 0px',
          threshold: [0, 0.6, 1],
        },
      );
      observer.observe(sheetElement);
      if (sentinel !== null) observer.observe(sentinel);
    } else {
      // Ambientes sem IntersectionObserver (ex.: jsdom): a geometria decide.
      const rect = scrollerElement.getBoundingClientRect();
      const fallbackLineY = rect.top + rect.height * READING_LINE_RATIO;
      sentinelVisible = sentinel !== null && sentinel.getBoundingClientRect().top <= fallbackLineY;
      scheduleFrame();
    }

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => scheduleFrame());
      resizeObserver.observe(scrollerElement);
      resizeObserver.observe(sheetElement);
    }

    const fontsReady: Promise<FontFaceSet> | undefined = document.fonts?.ready;
    if (fontsReady !== undefined && typeof fontsReady.then === 'function') {
      void fontsReady.then(() => {
        if (!disposed) scheduleFrame();
      });
    }

    scrollerElement.addEventListener('scroll', scheduleFrame, { passive: true });
    document.addEventListener('visibilitychange', handleVisibility);
    scheduleFrame();

    return () => {
      disposed = true;
      cancelFrame();
      cancelCompletion();
      observer?.disconnect();
      resizeObserver?.disconnect();
      for (const timer of dwellTimers.values()) clearTimeout(timer);
      dwellTimers.clear();
      scrollerElement.removeEventListener('scroll', scheduleFrame);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, savedProgress, sessionId, scrollerRef, sheetRef]);
}
