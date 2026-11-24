import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import { countWords, MAX_LETTER_CHARS, MAX_LETTER_WORDS } from '../../shared/limits';
import { RichTextToolbar } from './RichTextToolbar';
import { wrapSelection } from './richTextEditing';
import { PHOTO_ACCEPT, validatePhotoFiles } from './photoAssets';

interface PhotoPreview {
  id: string;
  url: string;
}

interface Caret {
  start: number;
  end: number;
}

interface LetterEditorProps {
  title: string;
  message: string;
  signature: string;
  photoCount: number;
  photoPreviews: readonly PhotoPreview[];
  onTitleChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSignatureChange: (value: string) => void;
  onPhotoFiles: (files: File[], caret: Caret) => void;
  onRemovePhoto: (id: string) => void;
}

const SHORTCUTS = {
  b: { open: '**', close: '**', placeholder: 'texto em negrito' },
  i: { open: '*', close: '*', placeholder: 'texto em itálico' },
  u: { open: '__', close: '__', placeholder: 'texto sublinhado' },
} as const;

function hasFiles(event: DragEvent<HTMLTextAreaElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

export function LetterEditor({
  title,
  message,
  signature,
  photoCount,
  photoPreviews,
  onTitleChange,
  onMessageChange,
  onSignatureChange,
  onPhotoFiles,
  onRemovePhoto,
}: LetterEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
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

  function acceptFiles(files: File[]): void {
    const textarea = textareaRef.current;
    const caret: Caret =
      textarea === null
        ? { start: message.length, end: message.length }
        : { start: textarea.selectionStart, end: textarea.selectionEnd };

    const { accepted, error } = validatePhotoFiles(files, photoCount);
    setPhotoError(error);
    if (accepted.length === 0) return;

    onPhotoFiles(accepted, caret);
    // Permite escolher novamente o mesmo arquivo depois de removê-lo.
    if (fileInputRef.current !== null) fileInputRef.current.value = '';
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    acceptFiles(Array.from(event.target.files ?? []));
  }

  function handleDragOver(event: DragEvent<HTMLTextAreaElement>): void {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  }

  function handleDragLeave(): void {
    setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLTextAreaElement>): void {
    const files = Array.from(event.dataTransfer.files);
    // Drop de texto deve continuar funcionando normalmente no textarea.
    if (files.length === 0) return;
    event.preventDefault();
    setDragActive(false);
    acceptFiles(files);
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
        <RichTextToolbar
          onApply={applyMark}
          onInsertPhoto={() => fileInputRef.current?.click()}
        />
        <input
          ref={fileInputRef}
          className="photo-file-input"
          type="file"
          accept={PHOTO_ACCEPT}
          multiple
          tabIndex={-1}
          onChange={handleFileChange}
        />
        <textarea
          ref={textareaRef}
          id="letter-message"
          data-letter-message-editor="true"
          className={dragActive ? 'letter-textarea--drop' : undefined}
          value={message}
          rows={10}
          placeholder="Escreva aqui. Deixe uma linha em branco para separar os parágrafos."
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          aria-describedby={`message-help message-count${photoError !== null ? ' photo-error' : ''}`}
          aria-invalid={overLimit}
        />
        {photoError !== null && (
          <p className="photo-error" id="photo-error" role="alert" aria-live="assertive">
            {photoError}
          </p>
        )}
        <div className="field__meta">
          <p className="field__hint" id="message-help">
            Duas quebras de linha criam um novo parágrafo. Use a barra acima ou Ctrl+B, Ctrl+I e
            Ctrl+U para formatar trechos. Arraste fotos para dentro da mensagem.
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
        {photoPreviews.length > 0 && (
          <ul className="photo-previews" aria-label="Fotos inseridas">
            {photoPreviews.map((preview) => (
              <li className="photo-previews__item" key={preview.id}>
                <img className="photo-previews__image" src={preview.url} alt="Foto inserida" />
                <button
                  className="photo-previews__remove"
                  type="button"
                  aria-label="Remover foto"
                  onClick={() => {
                    setPhotoError(null);
                    onRemovePhoto(preview.id);
                  }}
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
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
