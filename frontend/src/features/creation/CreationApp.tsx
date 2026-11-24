import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { createLetter } from '../../lib/api';
import type { LetterView } from '../../shared/types';
import { IdentificationFields } from './IdentificationFields';
import { LetterEditor } from './LetterEditor';
import { PersonalizationPanel } from './PersonalizationPanel';
import { PreviewPane } from './PreviewPane';
import { ShareBox } from './ShareBox';
import { useLetterDraft } from './useLetterDraft';
import './creation.css';

type SubmitStatus = 'idle' | 'sending' | 'error';

function validateDraft(title: string, message: string): string | null {
  if (title.trim().length === 0) {
    return 'Dê um título à sua carta antes de guardá-la.';
  }
  if (message.trim().length === 0) {
    return 'Escreva a mensagem: mesmo poucas palavras já bastam.';
  }
  return null;
}

export function CreationApp() {
  const { draft, updateField, updateTheme, setSenderAnonymous } = useLetterDraft();
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const previewLetter = useMemo<LetterView>(
    () => ({
      id: 'preview',
      title: draft.title,
      message: draft.message,
      senderName: draft.senderAnonymous ? null : draft.senderName || null,
      recipientName: draft.recipientName || null,
      signature: draft.signature || null,
      theme: draft.theme,
    }),
    [draft],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const invalidMessage = validateDraft(draft.title, draft.message);
    if (invalidMessage) {
      setErrorMessage(invalidMessage);
      setStatus('error');
      return;
    }

    setStatus('sending');
    setErrorMessage(null);

    try {
      const response = await createLetter(draft);
      setShareUrl(response.url);
      setStatus('idle');
    } catch (error) {
      setStatus('error');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível guardar a carta. Tente novamente em instantes.',
      );
    }
  }

  return (
    <main className="creation-page">
      <div className="creation-shell">
        <header className="creation-header">
          <p className="creation-header__eyebrow">Cartas que atravessam o tempo</p>
          <h1 className="creation-header__title">Entrelinhas</h1>
          <p className="creation-header__subtitle">
            Escreva o que ficou por dizer. Cada carta vive apenas uma leitura.
          </p>
        </header>

        <div className="creation-layout">
          {shareUrl ? (
            <ShareBox url={shareUrl} />
          ) : (
            <form className="creation-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
              <section className="form-card" aria-labelledby="identification-heading">
                <h2 className="form-card__title" id="identification-heading">
                  01 · De e para
                </h2>
                <IdentificationFields
                  senderName={draft.senderName}
                  senderAnonymous={draft.senderAnonymous}
                  recipientName={draft.recipientName}
                  onSenderNameChange={(value) => updateField('senderName', value)}
                  onSenderAnonymousChange={setSenderAnonymous}
                  onRecipientNameChange={(value) => updateField('recipientName', value)}
                />
              </section>

              <section className="form-card" aria-labelledby="editor-heading">
                <h2 className="form-card__title" id="editor-heading">
                  02 · As palavras
                </h2>
                <LetterEditor
                  title={draft.title}
                  message={draft.message}
                  signature={draft.signature}
                  onTitleChange={(value) => updateField('title', value)}
                  onMessageChange={(value) => updateField('message', value)}
                  onSignatureChange={(value) => updateField('signature', value)}
                />
              </section>

              <section className="form-card" aria-labelledby="personalization-heading">
                <h2 className="form-card__title" id="personalization-heading">
                  03 · O envelope
                </h2>
                <PersonalizationPanel theme={draft.theme} onThemeChange={updateTheme} />
              </section>

              {errorMessage && (
                <p className="form-error" role="alert">
                  {errorMessage}
                </p>
              )}

              <div className="creation-form__actions">
                <button className="btn btn--primary" type="submit" disabled={status === 'sending'}>
                  {status === 'sending' ? 'Guardando…' : 'Guardar carta'}
                </button>
                {status === 'sending' && (
                  <p className="sending-note" role="status">
                    Guardando sua carta com cuidado…
                  </p>
                )}
              </div>
            </form>
          )}

          <PreviewPane letter={previewLetter} />
        </div>
      </div>
    </main>
  );
}

export default CreationApp;
