import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLetter, uploadAsset } from '../../lib/api';
import { MAX_PHOTO_BYTES } from '../../shared/limits';
import { CreationApp } from './CreationApp';

vi.mock('../../lib/api', () => ({
  createLetter: vi.fn(() => Promise.resolve({ url: '/c/abc123' })),
  uploadAsset: vi.fn(() => Promise.resolve({ id: 'asset-1', uploadToken: 'token-1' })),
  assetUrl: vi.fn((id: string) => `/api/assets/${encodeURIComponent(id)}`),
  heartbeatReading: vi.fn(),
  getReadingState: vi.fn(),
  openLetter: vi.fn(),
  sendProgress: vi.fn(),
  completeReading: vi.fn(),
  ApiError: class extends Error {},
}));

const createLetterMock = vi.mocked(createLetter);
const uploadAssetMock = vi.mocked(uploadAsset);

/** O servidor deve devolver UUID v4: é o formato aceito pelo marcador. */
function assetUuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function photo(name = 'foto.png', size = 16): File {
  return new File([new Uint8Array(size)], name, { type: 'image/png' });
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

async function submitValidLetter(): Promise<void> {
  fireEvent.change(screen.getByLabelText('Título da carta'), {
    target: { value: 'Uma carta para você' },
  });
  fireEvent.change(screen.getByLabelText('Mensagem'), {
    target: { value: 'Olá.\n\nEscrevo devagar, apenas para você.' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Guardar carta/i }));
  await waitFor(() => expect(createLetterMock).toHaveBeenCalled());
}

function lastDraft(): Record<string, unknown> {
  const calls = createLetterMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as unknown as Record<string, unknown>;
}

beforeEach(() => {
  createLetterMock.mockReset();
  createLetterMock.mockResolvedValue({ url: '/c/abc123' });
  uploadAssetMock.mockReset();
  let counter = 0;
  uploadAssetMock.mockImplementation(() => {
    counter += 1;
    return Promise.resolve({ id: assetUuid(counter), uploadToken: `token-${counter}` });
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/preview-1');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
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
    await submitValidLetter();

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

  it('conta palavras e impede o envio acima do limite', () => {
    render(<CreationApp />);

    const textarea = screen.getByLabelText('Mensagem');
    fireEvent.change(textarea, { target: { value: 'uma duas tres' } });
    expect(document.getElementById('message-count')).toHaveTextContent('3');

    const longText = Array.from({ length: 4001 }, (_, index) => `palavra${index}`).join(' ');
    fireEvent.change(textarea, { target: { value: longText } });
    fireEvent.change(screen.getByLabelText('Título da carta'), {
      target: { value: 'Carta longa' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar carta/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/passou de/i);
    expect(createLetterMock).not.toHaveBeenCalled();
  });

  it('formata a seleção com o atalho Ctrl+B', () => {
    render(<CreationApp />);

    const textarea = screen.getByLabelText('Mensagem') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Olá mundo' } });
    textarea.setSelectionRange(0, 3);
    fireEvent.keyDown(textarea, { key: 'b', ctrlKey: true });

    expect(textarea).toHaveValue('**Olá** mundo');
  });

  it('aplica a cor da letra escolhida à prévia', () => {
    render(<CreationApp />);

    fireEvent.click(screen.getByRole('button', { name: 'Cor da letra Vinho' }));

    const preview = screen.getByRole('article');
    expect(preview.getAttribute('style')).toContain('#7c2d38');
  });

  it('envia fade e prazo escolhidos no draft, com padrões ligado e 10 minutos', async () => {
    render(<CreationApp />);

    expect(screen.getByLabelText('Apagar palavras durante a leitura')).toBeChecked();
    expect(screen.getByLabelText('Prazo de leitura')).toHaveValue('600');

    fireEvent.click(screen.getByLabelText('Apagar palavras durante a leitura'));
    fireEvent.change(screen.getByLabelText('Prazo de leitura'), { target: { value: '1800' } });
    await submitValidLetter();

    expect(lastDraft().fadeEnabled).toBe(false);
    expect(lastDraft().readTimeLimitSeconds).toBe(1800);
  });

  it('faz upload pelo seletor de arquivo e mostra prévia antes de salvar', async () => {
    render(<CreationApp />);
    const arquivo = photo();

    fireEvent.change(fileInput(), { target: { files: [arquivo] } });

    expect((screen.getByLabelText('Mensagem') as HTMLTextAreaElement).value).toMatch(
      /\[\[foto:/,
    );
    await waitFor(() => {
      expect(within(screen.getByRole('article')).getByAltText('Foto da carta')).toHaveAttribute(
        'src',
        'blob:http://localhost/preview-1',
      );
    });
    expect(uploadAssetMock).toHaveBeenCalledWith(arquivo, 'photo');

    await waitFor(() => {
      expect(within(screen.getByRole('article')).getByAltText('Foto da carta')).toHaveAttribute(
        'src',
        `/api/assets/${assetUuid(1)}`,
      );
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/preview-1');
  });

  it('aceita foto por drag-and-drop na posição escolhida do texto', async () => {
    render(<CreationApp />);
    const textarea = screen.getByLabelText('Mensagem');
    fireEvent.change(textarea, { target: { value: 'antes depois' } });
    (textarea as HTMLTextAreaElement).setSelectionRange(6, 6);
    const arquivo = photo();

    fireEvent.dragOver(textarea, { dataTransfer: { types: ['Files'], files: [arquivo] } });
    fireEvent.drop(textarea, { dataTransfer: { types: ['Files'], files: [arquivo] } });

    await waitFor(() => expect(uploadAssetMock).toHaveBeenCalledWith(arquivo, 'photo'));
    const message = (screen.getByLabelText('Mensagem') as HTMLTextAreaElement).value;
    expect(message).toMatch(/^antes \[\[foto:/);
    expect(message).toMatch(/depois$/);
  });

  it('não intercepta drop de texto no textarea', () => {
    render(<CreationApp />);
    const textarea = screen.getByLabelText('Mensagem');

    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['text/plain'], files: [] },
    });
    textarea.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(uploadAssetMock).not.toHaveBeenCalled();
  });

  it('limita a três fotos e avisa com mensagem acessível', async () => {
    render(<CreationApp />);

    fireEvent.change(fileInput(), {
      target: { files: [photo('a.png'), photo('b.png'), photo('c.png'), photo('d.png')] },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('máximo 3 fotos');
    await waitFor(() => expect(uploadAssetMock).toHaveBeenCalledTimes(3));
  });

  it('considera uploads pendentes no limite de três fotos', () => {
    uploadAssetMock.mockImplementation(() => new Promise(() => undefined));
    render(<CreationApp />);

    fireEvent.change(fileInput(), { target: { files: [photo('a.png')] } });
    fireEvent.change(fileInput(), { target: { files: [photo('b.png')] } });
    fireEvent.change(fileInput(), { target: { files: [photo('c.png')] } });
    fireEvent.change(fileInput(), { target: { files: [photo('d.png')] } });

    expect(screen.getByRole('alert')).toHaveTextContent('máximo 3 fotos');
    expect(uploadAssetMock).toHaveBeenCalledTimes(3);
  });

  it('preserva os marcadores quando dois lotes chegam em sequência rápida', () => {
    render(<CreationApp />);
    const textarea = screen.getByLabelText('Mensagem') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'início' } });
    textarea.setSelectionRange(6, 6);

    fireEvent.change(fileInput(), { target: { files: [photo('a.png')] } });
    fireEvent.change(fileInput(), { target: { files: [photo('b.png')] } });

    const value = (screen.getByLabelText('Mensagem') as HTMLTextAreaElement).value;
    expect(value.match(/\[\[foto:/g)).toHaveLength(2);
    expect(value.startsWith('início')).toBe(true);
  });

  it('rejeita arquivo acima de 2 MiB sem tentar upload', () => {
    render(<CreationApp />);
    const grande = photo('grande.png', MAX_PHOTO_BYTES + 1);

    fireEvent.change(fileInput(), { target: { files: [grande] } });

    expect(screen.getByRole('alert')).toHaveTextContent('2 MiB');
    expect(uploadAssetMock).not.toHaveBeenCalled();
  });

  it('rejeita tipo de arquivo fora da whitelist', () => {
    render(<CreationApp />);

    fireEvent.change(fileInput(), {
      target: { files: [new File(['x'], 'x.gif', { type: 'image/gif' })] },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('PNG, JPEG ou WebP');
    expect(uploadAssetMock).not.toHaveBeenCalled();
  });

  it('impede o envio enquanto há upload pendente', () => {
    let finishUpload: ((value: { id: string; uploadToken: string }) => void) | null = null;
    uploadAssetMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpload = resolve;
        }),
    );
    render(<CreationApp />);

    fireEvent.change(fileInput(), { target: { files: [photo()] } });

    expect(screen.getByRole('button', { name: /Aguardando fotos/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Título da carta'), { target: { value: 'Título' } });
    fireEvent.click(screen.getByRole('button', { name: /Aguardando fotos/i }));
    expect(createLetterMock).not.toHaveBeenCalled();

    expect(finishUpload).not.toBeNull();
    (finishUpload as unknown as (value: { id: string; uploadToken: string }) => void)({
      id: assetUuid(1),
      uploadToken: 'token-1',
    });
  });

  it('faz upload do selo em branco e grava sealAssetId no draft', async () => {
    render(<CreationApp />);

    fireEvent.click(screen.getByRole('radio', { name: /Em branco/i }));
    expect(screen.getByLabelText('Área de desenho do selo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Usar desenho' }));

    await waitFor(() => expect(uploadAssetMock).toHaveBeenCalledWith(expect.any(File), 'seal'));
    await submitValidLetter();

    expect(lastDraft().sealAssetId).toBe(assetUuid(1));
    expect((lastDraft().assets as Array<{ id: string }>).map((item) => item.id)).toContain(
      assetUuid(1),
    );
  });

  it('revoga a object URL ao limpar o selo', async () => {
    render(<CreationApp />);
    fireEvent.click(screen.getByRole('radio', { name: /Em branco/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Usar desenho' }));
    await waitFor(() => expect(uploadAssetMock).toHaveBeenCalledWith(expect.any(File), 'seal'));

    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }));

    expect(screen.queryByAltText('Prévia do selo desenhado')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
