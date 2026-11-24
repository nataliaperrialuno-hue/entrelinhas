import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  assetUrl,
  completeReading,
  getReadingState,
  heartbeatReading,
  openLetter,
  sendProgress,
} from '../../lib/api';
import type { LetterView } from '../../shared/types';
import { ReadingApp } from './ReadingApp';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    getReadingState: vi.fn(),
    openLetter: vi.fn(),
    heartbeatReading: vi.fn(),
    sendProgress: vi.fn().mockResolvedValue({ progress: 0 }),
    completeReading: vi.fn().mockResolvedValue({ state: 'completed' }),
    assetUrl: vi.fn((id: string) => `/api/assets/${encodeURIComponent(id)}`),
  };
});

type StateResponse = Awaited<ReturnType<typeof getReadingState>>;

function stateResponse(overrides: Partial<StateResponse> = {}): StateResponse {
  return {
    state: 'opening',
    progress: 0,
    readDeadlineAt: null,
    idleDeadlineAt: null,
    fadeEnabled: true,
    sealAssetId: null,
    ...overrides,
  };
}

const HEARTBEAT_TEST_MS = 30_000;
const PHOTO_ID = '00000000-0000-4000-8000-000000000000';

const letter: LetterView = {
  id: 'carta-1',
  title: 'Título da carta',
  message: 'Primeiro parágrafo.\n\nSegundo parágrafo.',
  senderName: 'Ana',
  recipientName: 'Bia',
  signature: 'Com carinho, Ana',
  theme: {
    envelope: 'classic',
    seal: 'wine',
    palette: 'sepia',
    typography: 'serif',
    paper: 'linen',
  },
};

async function flushLoad(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendProgress).mockResolvedValue({ progress: 0 });
  vi.mocked(completeReading).mockResolvedValue({ state: 'completed' });
  vi.mocked(assetUrl).mockImplementation((id: string) => `/api/assets/${encodeURIComponent(id)}`);
  vi.mocked(heartbeatReading).mockResolvedValue({
    state: 'reading',
    progress: 0,
    readDeadlineAt: null,
    idleDeadlineAt: null,
  });

  // A leitura depende de geometria real; nestes testes o hook permanece inerte.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    },
  );
  vi.stubGlobal('requestAnimationFrame', (): number => 1);
  vi.stubGlobal('cancelAnimationFrame', (): void => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('ReadingApp', () => {
  it('mostra o aviso sem buscar o conteúdo antes de continuar', async () => {
    vi.mocked(getReadingState).mockResolvedValue(stateResponse({ state: 'opening' }));

    render(<ReadingApp sessionId="sessao-1" />);

    expect(await screen.findByText(/Antes de continuar\.\.\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
    expect(openLetter).not.toHaveBeenCalled();
    expect(screen.queryByText('Título da carta')).not.toBeInTheDocument();
  });

  it('abre a carta ao clicar no selo e exibe título e mensagem', async () => {
    vi.mocked(getReadingState).mockResolvedValue(stateResponse({ state: 'opening' }));
    vi.mocked(openLetter).mockResolvedValue(letter);

    render(<ReadingApp sessionId="sessao-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));

    const seal = await screen.findByRole('button', { name: 'Abrir carta' });
    fireEvent.click(seal);
    fireEvent.animationEnd(seal);

    expect(await screen.findByRole('heading', { name: 'Título da carta' })).toBeInTheDocument();
    expect(screen.getByText(/Primeiro parágrafo/)).toBeInTheDocument();
    expect(openLetter).toHaveBeenCalledWith('sessao-1');
  });

  it('resolve o marcador de foto na carta lida sem exibir o texto literal', async () => {
    const letterWithPhoto: LetterView = {
      ...letter,
      message: `Olha a foto: [[foto:${PHOTO_ID}]]`,
    };
    vi.mocked(getReadingState).mockResolvedValue(stateResponse({ state: 'reading', progress: 0 }));
    vi.mocked(openLetter).mockResolvedValue(letterWithPhoto);

    render(<ReadingApp sessionId="sessao-1" />);
    await flushLoad();

    expect(screen.getByRole('heading', { name: 'Título da carta' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Foto da carta' })).toHaveAttribute(
      'src',
      `/api/assets/${PHOTO_ID}`,
    );
    expect(document.body.textContent).not.toContain(`[[foto:${PHOTO_ID}]]`);
    expect(assetUrl).toHaveBeenCalledWith(PHOTO_ID);
  });

  it('ajusta o aviso quando o apagamento progressivo está desligado', async () => {
    vi.mocked(getReadingState).mockResolvedValue(
      stateResponse({ state: 'opening', fadeEnabled: false }),
    );

    render(<ReadingApp sessionId="sessao-1" />);

    expect(await screen.findByText(/Antes de continuar\.\.\./)).toBeInTheDocument();
    expect(
      screen.getByText(/As palavras permanecem visíveis durante a leitura/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/as palavras desaparecerão/)).not.toBeInTheDocument();
  });

  it('renderiza o selo personalizado no envelope quando há assetId', async () => {
    vi.mocked(getReadingState).mockResolvedValue(
      stateResponse({ state: 'opening', sealAssetId: 'selo-42' }),
    );

    render(<ReadingApp sessionId="sessao-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));

    expect(await screen.findByRole('button', { name: 'Abrir carta' })).toBeInTheDocument();
    const image = document.querySelector<HTMLImageElement>('.wax-seal__image');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toBe('/api/assets/selo-42');
    expect(assetUrl).toHaveBeenCalledWith('selo-42');
  });

  it('mostra a mensagem final com link para escrever outra carta', async () => {
    vi.mocked(getReadingState).mockResolvedValue(stateResponse({ state: 'completed', progress: 1 }));

    render(<ReadingApp sessionId="sessao-1" />);

    expect(await screen.findByText(/Esta carta já cumpriu seu propósito/)).toBeInTheDocument();
    expect(screen.getByText(/Algumas palavras precisam apenas ser sentidas/)).toBeInTheDocument();
    const home = screen.getByRole('link', { name: 'Home — escrever outra carta' });
    expect(home).toHaveAttribute('href', '/');
    expect(openLetter).not.toHaveBeenCalled();
  });

  it('exibe erro quando a leitura não está mais disponível (410)', async () => {
    vi.mocked(getReadingState).mockRejectedValue(new ApiError(410, 'expirada'));

    render(<ReadingApp sessionId="sessao-1" />);

    expect(await screen.findByText('Esta carta não está mais disponível.')).toBeInTheDocument();
  });

  it('mostra indisponibilidade quando o menor prazo vence e limpa os timers', async () => {
    vi.useFakeTimers();
    const now = Date.now();

    try {
      vi.mocked(getReadingState)
        .mockResolvedValueOnce(
          stateResponse({
            state: 'reading',
            progress: 0.2,
            readDeadlineAt: now + 1_000,
            idleDeadlineAt: now + 60_000,
          }),
        )
        .mockResolvedValue(stateResponse({ state: 'expired', progress: 0.2 }));
      vi.mocked(openLetter).mockResolvedValue(letter);

      render(<ReadingApp sessionId="sessao-1" />);
      await flushLoad();

      expect(screen.getByRole('heading', { name: 'Título da carta' })).toBeInTheDocument();
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });

      expect(screen.getByText('Esta carta não está mais disponível.')).toBeInTheDocument();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renova prazos via heartbeat só com atividade recente e aba visível, e limpa ao desmontar', async () => {
    vi.useFakeTimers();
    const now = Date.now();

    try {
      vi.mocked(getReadingState).mockResolvedValue(
        stateResponse({
          state: 'reading',
          progress: 0.2,
          readDeadlineAt: now + 600_000,
          idleDeadlineAt: now + 600_000,
        }),
      );
      vi.mocked(openLetter).mockResolvedValue(letter);
      vi.mocked(heartbeatReading).mockResolvedValue({
        state: 'reading',
        progress: 0.2,
        readDeadlineAt: now + 900_000,
        idleDeadlineAt: now + 900_000,
      });

      const { unmount } = render(<ReadingApp sessionId="sessao-1" />);
      await flushLoad();

      await act(async () => {
        vi.advanceTimersByTime(HEARTBEAT_TEST_MS);
      });
      expect(heartbeatReading).not.toHaveBeenCalled();

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      fireEvent.keyDown(document.body, { key: 'a' });
      await act(async () => {
        vi.advanceTimersByTime(HEARTBEAT_TEST_MS);
      });
      expect(heartbeatReading).not.toHaveBeenCalled();

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      fireEvent.keyDown(document.body, { key: 'a' });
      await act(async () => {
        vi.advanceTimersByTime(HEARTBEAT_TEST_MS);
      });

      expect(heartbeatReading).toHaveBeenCalledTimes(1);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      vi.useRealTimers();
    }
  });
});
