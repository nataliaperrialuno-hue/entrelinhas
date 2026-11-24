import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RichTextToolbar } from './RichTextToolbar';

describe('RichTextToolbar', () => {
  it('aplica negrito, itálico e sublinhado', () => {
    const onApply = vi.fn();
    render(<RichTextToolbar onApply={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: 'Negrito (Ctrl+B)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Itálico (Ctrl+I)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sublinhado (Ctrl+U)' }));

    expect(onApply).toHaveBeenNthCalledWith(1, '**', '**', 'texto em negrito');
    expect(onApply).toHaveBeenNthCalledWith(2, '*', '*', 'texto em itálico');
    expect(onApply).toHaveBeenNthCalledWith(3, '__', '__', 'texto sublinhado');
  });

  it('oferece as cores da carta para o trecho selecionado', () => {
    const onApply = vi.fn();
    render(<RichTextToolbar onApply={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar cor Vinho ao trecho' }));

    expect(onApply).toHaveBeenCalledWith('[[cor:#7c2d38]]', '[[/cor]]', 'texto colorido');
  });

  it('oferece fonte e tamanho com valores da whitelist', () => {
    const onApply = vi.fn();
    render(<RichTextToolbar onApply={onApply} />);

    fireEvent.click(screen.getByText('Manuscrita'));
    fireEvent.click(screen.getByText('Maior'));

    expect(onApply).toHaveBeenNthCalledWith(
      1,
      '[[fonte:hand]]',
      '[[/fonte]]',
      'texto com outra fonte',
    );
    expect(onApply).toHaveBeenNthCalledWith(
      2,
      '[[tamanho:lg]]',
      '[[/tamanho]]',
      'texto redimensionado',
    );
  });
});
