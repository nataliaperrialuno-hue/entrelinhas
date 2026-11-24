import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { countWords, MAX_LETTER_CHARS, MAX_LETTER_WORDS } from '../../shared/limits';
import { RichTextToolbar } from './RichTextToolbar';
import { wrapSelection } from './richTextEditing';

interface LetterEditorProps {
  title: string;
  message: string;
  signature: string;
  onTitleChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSignatureChange: (value: string) => void;
}

const SHORTCUTS = {
  b: { open: '**', close: '**', placeholder: 'texto em negrito' },
  i: { open: '*', close: '*', placeholder: 'texto em itálico' },
  u: { open: '__', close: '__', placeholder: 'texto sublinhado' },
} as const;

export function LetterEditor({
  title,
  message,
  signature,
  onTitleChange,
  onMessageChange,
  onSignatureChange,
}: LetterEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wordCount = countWords(message);
  const overLimit = wordCount > MAX_LETTER_WORDS || message.length > MAX_LETTER_CHARS;

  function applyMark(open: string, close: string, placeholder: string): void {
    const textarea = textareaRef.current;
    if (textarea === null) return;

    const result = wrapSelection(
      message,
      textarea.selectionStart,
      textarea.selectionEnd,
      open,
      close,
      placeholder,
    );
    onMessageChange(result.value);

    // A seleção é restaurada depois do re-render controlado pelo React.
    window.setTimeout(() => {
      const current = textareaRef.current;
      if (current === null) return;
      current.focus();
      current.setSelectionRange(result.selectionStart, result.selectionEnd);
    }, 0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (!event.ctrlKey && !event.metaKey) return;
    const mark = SHORTCUTS[event.key.toLowerCase() as keyof typeof SHORTCUTS];
    if (mark === undefined) return;
    event.preventDefault();
    applyMark(mark.open, mark.close, mark.placeholder);
  }

  return (
    <div className="field-grid">
      <div className="field">
        <label className="field__label" htmlFor="letter-title">
          Título da carta
        </label>
        <input
          id="letter-title"
          type="text"
          value={title}
          placeholder="Um nome para o que ficou por dizer"
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="letter-message">
          Mensagem
        </label>
        <RichTextToolbar onApply={applyMark} />
        <textarea
          ref={textareaRef}
          id="letter-message"
          value={message}
          rows={10}
          placeholder="Escreva aqui. Deixe uma linha em branco para separar os parágrafos."
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-describedby="message-help message-count"
          aria-invalid={overLimit}
        />
        <div className="field__meta">
          <p className="field__hint" id="message-help">
            Duas quebras de linha criam um novo parágrafo. Use a barra acima ou Ctrl+B, Ctrl+I e
            Ctrl+U para formatar trechos.
          </p>
          <p
            className={`field__counter${overLimit ? ' field__counter--over' : ''}`}
            id="message-count"
            aria-live="polite"
          >
            {wordCount.toLocaleString('pt-BR')} / {MAX_LETTER_WORDS.toLocaleString('pt-BR')}{' '}
            palavras
          </p>
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="letter-signature">
          Assinatura
        </label>
        <input
          id="letter-signature"
          type="text"
          value={signature}
          placeholder="Com carinho, ..."
          onChange={(event) => onSignatureChange(event.target.value)}
        />
      </div>
    </div>
  );
}

export default LetterEditor;
