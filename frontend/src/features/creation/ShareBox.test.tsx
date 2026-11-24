import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareBox } from './ShareBox';

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

describe('ShareBox', () => {
  it('mostra o contador no singular quando a carta é a primeira', () => {
    render(<ShareBox url="/c/abc123" writtenCount={1} />);

    expect(screen.getByText('Você já escreveu 1 carta neste navegador.')).toBeInTheDocument();
  });

  it('pluraliza o contador para zero e mais de uma carta', () => {
    const { rerender } = render(<ShareBox url="/c/abc123" writtenCount={0} />);
    expect(screen.getByText('Você já escreveu 0 cartas neste navegador.')).toBeInTheDocument();

    rerender(<ShareBox url="/c/abc123" writtenCount={3} />);
    expect(screen.getByText('Você já escreveu 3 cartas neste navegador.')).toBeInTheDocument();
  });

  it('mantém o botão de copiar o link intacto ao lado do contador', async () => {
    render(<ShareBox url="/c/abc123" writtenCount={2} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(new URL('/c/abc123', window.location.origin).toString()),
    );
    expect(screen.getByLabelText('Link da carta')).toBeInTheDocument();
  });
});
