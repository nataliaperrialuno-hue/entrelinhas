import type { MouseEvent } from 'react';
import { DEFAULT_INK_COLOR, LETTER_COLORS } from '../../shared/themes';

interface RichTextToolbarProps {
  onApply: (open: string, close: string, placeholder: string) => void;
}

interface MarkDefinition {
  id: string;
  label: string;
  title: string;
  open: string;
  close: string;
  placeholder: string;
}

const SIMPLE_MARKS: readonly MarkDefinition[] = [
  {
    id: 'bold',
    label: 'B',
    title: 'Negrito (Ctrl+B)',
    open: '**',
    close: '**',
    placeholder: 'texto em negrito',
  },
  {
    id: 'italic',
    label: 'I',
    title: 'Itálico (Ctrl+I)',
    open: '*',
    close: '*',
    placeholder: 'texto em itálico',
  },
  {
    id: 'underline',
    label: 'S',
    title: 'Sublinhado (Ctrl+U)',
    open: '__',
    close: '__',
    placeholder: 'texto sublinhado',
  },
  {
    id: 'highlight',
    label: 'Destaque',
    title: 'Destaque',
    open: '==',
    close: '==',
    placeholder: 'texto destacado',
  },
];

const FONTS = [
  { id: 'serif', label: 'Serifada' },
  { id: 'hand', label: 'Manuscrita' },
  { id: 'mono', label: 'Monoespaçada' },
] as const;

const SIZES = [
  { id: 'sm', label: 'Menor' },
  { id: 'md', label: 'Normal' },
  { id: 'lg', label: 'Maior' },
] as const;

function closePopover(target: EventTarget | null): void {
  if (target instanceof Element) {
    const details = target.closest('details');
    if (details !== null) details.open = false;
  }
}

export function RichTextToolbar({ onApply }: RichTextToolbarProps) {
  function apply(
    target: EventTarget | null,
    open: string,
    close: string,
    placeholder: string,
  ): void {
    onApply(open, close, placeholder);
    closePopover(target);
  }

  function handleSimpleClick(event: MouseEvent<HTMLButtonElement>, mark: MarkDefinition): void {
    apply(event.currentTarget, mark.open, mark.close, mark.placeholder);
  }

  return (
    <div className="rt-toolbar" role="toolbar" aria-label="Ferramentas de formatação">
      {SIMPLE_MARKS.map((mark) => (
        <button
          className={`rt-toolbar__button${mark.id === 'highlight' ? ' rt-toolbar__button--wide' : ''}`}
          key={mark.id}
          type="button"
          title={mark.title}
          aria-label={mark.title}
          onClick={(event) => handleSimpleClick(event, mark)}
        >
          {mark.label}
        </button>
      ))}

      <details className="rt-popover">
        <summary className="rt-toolbar__button" title="Cor da letra">
          Cor
        </summary>
        <div className="rt-popover__panel">
          <p className="rt-popover__label">Cor do trecho selecionado</p>
          <div className="rt-swatch-grid">
            {LETTER_COLORS.map((color) => (
              <button
                className="rt-swatch"
                key={color.id}
                type="button"
                style={{ backgroundColor: color.value }}
                title={color.label}
                aria-label={`Aplicar cor ${color.label} ao trecho`}
                onClick={(event) =>
                  apply(
                    event.currentTarget,
                    `[[cor:${color.value}]]`,
                    '[[/cor]]',
                    'texto colorido',
                  )
                }
              />
            ))}
          </div>
          <label className="rt-popover__custom">
            Outra cor
            <input
              type="color"
              defaultValue={DEFAULT_INK_COLOR}
              onChange={(event) =>
                apply(
                  event.currentTarget,
                  `[[cor:${event.currentTarget.value.toLowerCase()}]]`,
                  '[[/cor]]',
                  'texto colorido',
                )
              }
            />
          </label>
        </div>
      </details>

      <details className="rt-popover">
        <summary className="rt-toolbar__button" title="Fonte do trecho">
          Fonte
        </summary>
        <div className="rt-popover__panel">
          <p className="rt-popover__label">Fonte do trecho selecionado</p>
          {FONTS.map((font) => (
            <button
              className="rt-popover__option"
              key={font.id}
              type="button"
              onClick={(event) =>
                apply(
                  event.currentTarget,
                  `[[fonte:${font.id}]]`,
                  '[[/fonte]]',
                  'texto com outra fonte',
                )
              }
            >
              {font.label}
            </button>
          ))}
        </div>
      </details>

      <details className="rt-popover">
        <summary className="rt-toolbar__button" title="Tamanho do trecho">
          Tamanho
        </summary>
        <div className="rt-popover__panel">
          <p className="rt-popover__label">Tamanho do trecho selecionado</p>
          {SIZES.map((size) => (
            <button
              className="rt-popover__option"
              key={size.id}
              type="button"
              onClick={(event) =>
                apply(
                  event.currentTarget,
                  `[[tamanho:${size.id}]]`,
                  '[[/tamanho]]',
                  'texto redimensionado',
                )
              }
            >
              {size.label}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

export default RichTextToolbar;
