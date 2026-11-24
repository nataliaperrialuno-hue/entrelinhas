import { useEffect, useState } from 'react';

interface IdentificationFieldsProps {
  senderName: string;
  senderAnonymous: boolean;
  recipientName: string;
  onSenderNameChange: (value: string) => void;
  onSenderAnonymousChange: (value: boolean) => void;
  onRecipientNameChange: (value: string) => void;
}

export function IdentificationFields({
  senderName,
  senderAnonymous,
  recipientName,
  onSenderNameChange,
  onSenderAnonymousChange,
  onRecipientNameChange,
}: IdentificationFieldsProps) {
  const [recipientOmitted, setRecipientOmitted] = useState(recipientName.trim().length === 0);

  useEffect(() => {
    if (recipientName.trim().length > 0) {
      setRecipientOmitted(false);
    }
  }, [recipientName]);

  function handleRecipientOmittedChange(checked: boolean): void {
    setRecipientOmitted(checked);
    if (checked) {
      onRecipientNameChange('');
    }
  }

  return (
    <div className="field-grid">
      <div className="field">
        <label className="field__label" htmlFor="sender-name">
          De:
        </label>
        <input
          id="sender-name"
          type="text"
          value={senderAnonymous ? '' : senderName}
          disabled={senderAnonymous}
          autoComplete="name"
          placeholder="Seu nome, se quiser assinar com ele"
          onChange={(event) => onSenderNameChange(event.target.value)}
          aria-describedby={senderAnonymous ? 'sender-anonymous-help' : undefined}
        />
      </div>

      <div className="checkbox-row">
        <input
          id="sender-anonymous"
          type="checkbox"
          checked={senderAnonymous}
          onChange={(event) => onSenderAnonymousChange(event.target.checked)}
          aria-describedby="sender-anonymous-help"
        />
        <div>
          <label htmlFor="sender-anonymous">Enviar anonimamente</label>
          <p className="field__hint" id="sender-anonymous-help">
            Seu nome não aparecerá na carta nem no sobrescrito.
          </p>
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="recipient-name">
          Para:
        </label>
        <input
          id="recipient-name"
          type="text"
          value={recipientName}
          disabled={recipientOmitted}
          placeholder="Quem vai receber estas palavras?"
          onChange={(event) => {
            setRecipientOmitted(false);
            onRecipientNameChange(event.target.value);
          }}
          aria-describedby="recipient-help"
        />
        <p className="field__hint" id="recipient-help">
          Pode deixar em branco: algumas cartas não têm nome de destinatário.
        </p>
      </div>

      <div className="checkbox-row">
        <input
          id="recipient-omitted"
          type="checkbox"
          checked={recipientOmitted}
          onChange={(event) => handleRecipientOmittedChange(event.target.checked)}
          aria-describedby="recipient-help"
        />
        <label htmlFor="recipient-omitted">Não informar destinatário</label>
      </div>
    </div>
  );
}

export default IdentificationFields;
