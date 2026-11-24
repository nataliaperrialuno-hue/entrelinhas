import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, completeReading, getReadingState, openLetter, sendProgress } from '../../lib/api';
import type { LetterView } from '../../shared/types';
import { ReadingApp } from './ReadingApp';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    getReadingState: vi.fn(),
    openLetter: vi.fn(),
    sendProgress: vi.fn().mockResolvedValue({ progress: 0 }),
    completeReading: vi.fn().mockResolvedValue({ state: 'completed' }),
  };
});

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendProgress).mockResolvedValue({ progress: 0 });
  vi.mocked(completeReading).mockResolvedValue({ state: 'completed' });

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
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('ReadingApp', () => {
  it('mostra o aviso sem buscar o conteúdo antes de continuar', async () => {
    vi.mocked(getReadingState).mockResolvedValue({ state: 'opening', progress: 0 });

    render(<ReadingApp sessionId="sessao-1" />);

    expect(await screen.findByText(/Antes de continuar\.\.\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
    expect(openLetter).not.toHaveBeenCalled();
    expect(screen.queryByText('Título da carta')).not.toBeInTheDocument();
  });

  it('abre a carta ao clicar no selo e exibe título e mensagem', async () => {
    vi.mocked(getReadingState).mockResolvedValue({ state: 'opening', progress: 0 });
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

  it('mostra a mensagem final quando o estado já está concluído', async () => {
    vi.mocked(getReadingState).mockResolvedValue({ state: 'completed', progress: 1 });

    render(<ReadingApp sessionId="sessao-1" />);

    expect(await screen.findByText(/Esta carta já cumpriu seu propósito/)).toBeInTheDocument();
    expect(screen.getByText(/Algumas palavras precisam apenas ser sentidas/)).toBeInTheDocument();
    expect(openLetter).not.toHaveBeenCalled();
  });

  it('exibe erro quando a leitura não está mais disponível (410)', async () => {
    vi.mocked(getReadingState).mockRejectedValue(new ApiError(410, 'expirada'));

    render(<ReadingApp sessionId="sessao-1" />);

    expect(await screen.findByText('Esta carta não está mais disponível.')).toBeInTheDocument();
  });
});
