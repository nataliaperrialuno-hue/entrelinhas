import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

// jsdom define getContext/toBlob, mas lança "Not implemented". Substituímos
// sempre no ambiente de teste por um mock mínimo e inofensivo aos testes legados.
const canvasPrototype = HTMLCanvasElement.prototype;

Object.defineProperty(canvasPrototype, 'getContext', {
  writable: true,
  configurable: true,
  value: (): CanvasRenderingContext2D | null => {
    const noop = (): void => undefined;
    return {
      clearRect: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      stroke: noop,
      closePath: noop,
      fillRect: noop,
      globalCompositeOperation: 'source-over',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'round',
      lineJoin: 'round',
    } as unknown as CanvasRenderingContext2D;
  },
});

Object.defineProperty(canvasPrototype, 'toBlob', {
  writable: true,
  configurable: true,
  value: (callback: BlobCallback, _type?: string): void => {
    callback(new Blob(['selo'], { type: 'image/png' }));
  },
});

let objectUrlCounter = 0;

if (typeof URL.createObjectURL !== 'function') {
  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    configurable: true,
    value: (): string => {
      objectUrlCounter += 1;
      return `blob:http://localhost/${objectUrlCounter}`;
    },
  });
}

if (typeof URL.revokeObjectURL !== 'function') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    writable: true,
    configurable: true,
    value: (_url: string): void => undefined,
  });
}
