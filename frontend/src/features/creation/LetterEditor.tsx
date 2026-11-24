interface LetterEditorProps {
  title: string;
  message: string;
  signature: string;
  onTitleChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSignatureChange: (value: string) => void;
}

export function LetterEditor({
  title,
  message,
  signature,
  onTitleChange,
  onMessageChange,
  onSignatureChange,
}: LetterEditorProps) {
  const characterCount = message.length;

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
        <textarea
          id="letter-message"
          value={message}
          rows={10}
          placeholder="Escreva aqui. Deixe uma linha em branco para separar os parágrafos."
          onChange={(event) => onMessageChange(event.target.value)}
          aria-describedby="message-help message-count"
        />
        <div className="field__meta">
          <p className="field__hint" id="message-help">
            Duas quebras de linha criam um novo parágrafo na carta.
          </p>
          <p className="field__counter" id="message-count" aria-live="polite">
            {characterCount} {characterCount === 1 ? 'caractere' : 'caracteres'}
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
