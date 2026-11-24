import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLetter } from '../../lib/api';
import { CreationApp } from './CreationApp';

vi.mock('../../lib/api', () => ({
  createLetter: vi.fn(() => Promise.resolve({ url: '/c/abc123' })),
}));

const createLetterMock = vi.mocked(createLetter);

beforeEach(() => {
  createLetterMock.mockReset();
  createLetterMock.mockResolvedValue({ url: '/c/abc123' });
});

describe('CreationApp', () => {
  it('renderiza os campos de identificação, editor, personalização e prévia', () => {
    render(<CreationApp />);

    expect(screen.getByLabelText('De:')).toBeInTheDocument();
    expect(screen.getByLabelText('Para:')).toBeInTheDocument();
    expect(screen.getByLabelText('Título da carta')).toBeInTheDocument();
    expect(screen.getByLabelText('Mensagem')).toBeInTheDocument();
    expect(screen.getByLabelText('Assinatura')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Sépia/i })).toBeChecked();
    expect(screen.getByRole('heading', { name: 'Prévia da carta' })).toBeInTheDocument();
  });

  it('remove o remetente da prévia quando o envio é anônimo', () => {
    render(<CreationApp />);

    fireEvent.change(screen.getByLabelText('De:'), { target: { value: 'Ana' } });
    const preview = screen.getByRole('article');
    expect(within(preview).getByText(/^De: Ana$/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Enviar anonimamente/i));

    expect(within(preview).queryByText(/^De:/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('De:')).toBeDisabled();
    expect(screen.getByLabelText('De:')).toHaveValue('');
  });

  it('impede o envio sem título e sem mensagem', () => {
    render(<CreationApp />);

    const submitButton = screen.getByRole('button', { name: /Guardar carta/i });
    const form = submitButton.closest('form');
    expect(form).not.toBeNull();

    fireEvent.submit(form as HTMLFormElement);

    expect(screen.getByRole('alert')).toHaveTextContent('Dê um título à sua carta');
    expect(createLetterMock).not.toHaveBeenCalled();
  });

  it('exibe o link e o link do WhatsApp após envio bem-sucedido', async () => {
    render(<CreationApp />);

    fireEvent.change(screen.getByLabelText('Título da carta'), {
      target: { value: 'Uma carta para você' },
    });
    fireEvent.change(screen.getByLabelText('Mensagem'), {
      target: { value: 'Olá.\n\nEscrevo devagar, apenas para você.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar carta/i }));

    const absoluteUrl = new URL('/c/abc123', window.location.origin).toString();
    await waitFor(() => {
      expect(screen.getByLabelText('Link da carta')).toHaveValue(absoluteUrl);
    });

    expect(screen.queryByRole('button', { name: /Guardar carta/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /WhatsApp/i })).toHaveAttribute(
      'href',
      `https://wa.me/?text=${encodeURIComponent('Recebi uma carta pelo Entrelinhas. Leia aqui: ' + absoluteUrl)}`,
    );
    expect(createLetterMock).toHaveBeenCalledTimes(1);
  });

  it('aplica a classe da paleta escolhida na prévia imediatamente', () => {
    render(<CreationApp />);

    fireEvent.click(screen.getByRole('radio', { name: /Rosado/i }));

    expect(screen.getByRole('article')).toHaveClass('theme-palette-rose');
  });
});
