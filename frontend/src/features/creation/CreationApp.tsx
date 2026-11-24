import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import { assetUrl, createLetter, uploadAsset } from '../../lib/api';
import {
  countWords,
  DEFAULT_READ_SECONDS,
  MAX_LETTER_CHARS,
  MAX_LETTER_WORDS,
} from '../../shared/limits';
import type { AssetRef, LetterView } from '../../shared/types';
import { IdentificationFields } from './IdentificationFields';
import {
  deleteDraft,
  getWrittenCount,
  incrementWrittenCount,
  listDrafts,
  saveDraft,
} from './letterNotebook';
import type { DraftRecord } from './letterNotebook';
import { LetterEditor } from './LetterEditor';
import { PersonalizationPanel } from './PersonalizationPanel';
import { createPhotoId, removeAssetToken, replaceAssetIdInText } from './photoAssets';
import { PreviewPane } from './PreviewPane';
import { insertToken } from './richTextEditing';
import { ShareBox } from './ShareBox';
import { useLetterDraft } from './useLetterDraft';
import './creation.css';

type SubmitStatus = 'idle' | 'sending' | 'error';

interface Caret {
  start: number;
  end: number;
}

const READ_TIME_OPTIONS = [
  { seconds: 300, label: '5 minutos' },
  { seconds: 600, label: '10 minutos' },
  { seconds: 900, label: '15 minutos' },
  { seconds: 1800, label: '30 minutos' },
  { seconds: 3600, label: '60 minutos' },
] as const;

function validateDraft(title: string, message: string): string | null {
  if (title.trim().length === 0) {
    return 'Dê um título à sua carta antes de guardá-la.';
  }
  if (message.trim().length === 0) {
    return 'Escreva a mensagem: mesmo poucas palavras já bastam.';
  }
  if (countWords(message) > MAX_LETTER_WORDS) {
    return `Esta carta passou de ${MAX_LETTER_WORDS.toLocaleString('pt-BR')} palavras. Reduza o texto para guardá-la.`;
  }
  if (message.length > MAX_LETTER_CHARS) {
    return `Esta carta passou de ${MAX_LETTER_CHARS.toLocaleString('pt-BR')} caracteres. Reduza o texto para guardá-la.`;
  }
  return null;
}

function isMessageEditor(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-letter-message-editor]') !== null;
}

export function CreationApp() {
  const {
    draft,
    updateField,
    updateMessageFrom,
    updateTheme,
    setSenderAnonymous,
    updateOptions,
    addAsset,
    removeAsset,
    registerPreviewUrl,
    getPreviewUrl,
    revokePreviewUrl,
    resolveAsset,
    applyDraft,
    reset,
  } = useLetterDraft();

  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [writtenCount, setWrittenCount] = useState(0);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const cancelledPhotoIdsRef = useRef<Set<string>>(new Set());
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setWrittenCount(getWrittenCount());
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    function handleEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      // O foco volta ao hambúrguer depois do re-render, como em LetterEditor.
      window.setTimeout(() => menuButtonRef.current?.focus(), 0);
    }

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [menuOpen]);

  const previewLetter = useMemo<LetterView>(
    () => ({
      id: 'preview',
      title: draft.title,
      message: draft.message,
      senderName: draft.senderAnonymous ? null : draft.senderName || null,
      recipientName: draft.recipientName || null,
      signature: draft.signature || null,
      theme: draft.theme,
      fadeEnabled: draft.fadeEnabled ?? true,
      sealAssetId: draft.sealAssetId ?? null,
    }),
    [draft],
  );

  const photoPreviews = useMemo(
    () =>
      (draft.assets ?? [])
        .filter((asset) => asset.id !== draft.sealAssetId)
        .map((asset) => ({
          id: asset.id,
          url: getPreviewUrl(asset.id) ?? assetUrl(asset.id),
        })),
    [draft.assets, draft.sealAssetId, getPreviewUrl],
  );

  const sealPreviewUrl =
    draft.sealAssetId === null || draft.sealAssetId === undefined
      ? null
      : getPreviewUrl(draft.sealAssetId);

  async function handlePhotoFiles(files: File[], caret: Caret): Promise<void> {
    const pending: Array<{ tempId: string; file: File }> = files.map((file) => {
      const tempId = createPhotoId();
      registerPreviewUrl(tempId, URL.createObjectURL(file));
      return { tempId, file };
    });

    // Inserção funcional: lotes rápidos não sobrescrevem o texto um do outro.
    updateMessageFrom((message) => {
      let current = message;
      let offset = caret.start;
      for (const { tempId } of pending) {
        const result = insertToken(current, offset, offset, `[[foto:${tempId}]]`);
        current = result.value;
        offset = result.selectionEnd;
      }
      return current;
    });
    setPendingUploads((current) => current + pending.length);

    for (const { tempId, file } of pending) {
      try {
        const asset = await uploadAsset(file, 'photo');
        if (cancelledPhotoIdsRef.current.has(tempId)) continue;
        addAsset(asset);
        updateMessageFrom((message) => replaceAssetIdInText(message, tempId, asset.id));
        // A object URL deixa de ser necessária: a prévia passa a usar /api/assets/:id.
        revokePreviewUrl(tempId);
      } catch (error) {
        updateMessageFrom((message) => removeAssetToken(message, tempId));
        revokePreviewUrl(tempId);
        setStatus('error');
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Não foi possível guardar uma das fotos. Tente novamente.',
        );
      } finally {
        cancelledPhotoIdsRef.current.delete(tempId);
        setPendingUploads((current) => Math.max(0, current - 1));
      }
    }
  }

  function handleRemovePhoto(id: string): void {
    cancelledPhotoIdsRef.current.add(id);
    updateMessageFrom((message) => removeAssetToken(message, id));
    removeAsset(id);
  }

  function handleSealAssetChange(asset: AssetRef | null, objectUrl: string | null): void {
    const previousId = draft.sealAssetId;
    if (previousId !== null && previousId !== undefined && previousId !== asset?.id) {
      revokePreviewUrl(previousId);
    }
    if (asset === null) {
      updateOptions({ sealAssetId: null });
      return;
    }
    addAsset(asset);
    updateOptions({ sealAssetId: asset.id });
    if (objectUrl !== null) registerPreviewUrl(asset.id, objectUrl);
  }

  function handleSaveDraft(): void {
    try {
      const saved = saveDraft(draft);
      setDrafts(listDrafts());
      setDraftStatus(
        `Rascunho guardado em ${new Date(saved.savedAt).toLocaleTimeString('pt-BR')}.`,
      );
      setErrorMessage(null);
    } catch (error) {
      setDraftStatus(
        error instanceof Error ? error.message : 'Não foi possível guardar o rascunho localmente.',
      );
    }
  }

  function handleToggleMenu(): void {
    const opening = !menuOpen;
    setMenuOpen(opening);
    if (!opening) {
      // O foco volta ao hambúrguer depois do re-render, como em LetterEditor.
      window.setTimeout(() => menuButtonRef.current?.focus(), 0);
    }
  }

  function handleCloseMenu(): void {
    setMenuOpen(false);
    window.setTimeout(() => menuButtonRef.current?.focus(), 0);
  }

  function handleToggleDrafts(): void {
    const opening = !draftsOpen;
    setDraftsOpen(opening);
    if (opening) setDrafts(listDrafts());
  }

  function handleLoadDraft(record: DraftRecord): void {
    applyDraft(record.draft);
    setShareUrl(null);
    setStatus('idle');
    setErrorMessage(null);
    setDraftsOpen(false);
    setDraftStatus('Rascunho carregado.');
    handleCloseMenu();
  }

  function handleDeleteDraft(id: string): void {
    deleteDraft(id);
    setDrafts(listDrafts());
  }

  function handleNewLetter(): void {
    reset();
    setShareUrl(null);
    setStatus('idle');
    setErrorMessage(null);
    setDraftStatus(null);
    setDraftsOpen(false);
    handleCloseMenu();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const invalidMessage = validateDraft(draft.title, draft.message);
    if (invalidMessage) {
      setErrorMessage(invalidMessage);
      setStatus('error');
      return;
    }
    if (pendingUploads > 0) {
      setErrorMessage('Aguarde o término do envio das fotos antes de guardar a carta.');
      setStatus('error');
      return;
    }

    setStatus('sending');
    setErrorMessage(null);

    try {
      const response = await createLetter(draft);
      setShareUrl(response.url);
      // A carta já foi criada (201): indisponibilidade do storage não desfaz o sucesso.
      try {
        setWrittenCount(incrementWrittenCount());
      } catch {
        // Contador local é apenas informativo; não interfere na carta enviada.
      }
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

  function handleContainerDragOver(event: DragEvent<HTMLElement>): void {
    // O textarea cuida do próprio drop; aqui apenas impedimos a navegação do
    // navegador quando um arquivo cai em qualquer outro ponto da página.
    if (isMessageEditor(event.target)) return;
    event.preventDefault();
  }

  function handleContainerDrop(event: DragEvent<HTMLElement>): void {
    if (isMessageEditor(event.target)) return;
    event.preventDefault();
  }

  const showAssetNotice =
    draft.theme.seal === 'custom' ||
    drafts.some((item) => item.draft.theme.seal === 'custom');

  return (
    <main
      className="creation-page"
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
    >
      <nav className="creation-menu" aria-label="Ferramentas de criação">
        <div className="creation-menu__bar">
          <button
            ref={menuButtonRef}
            className="btn btn--ghost creation-menu__toggle"
            type="button"
            aria-label="Abrir menu"
            aria-expanded={menuOpen}
            aria-controls="creation-menu-drawer"
            onClick={handleToggleMenu}
          >
            <svg
              className="creation-menu__icon"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
        <div
          className="creation-menu__overlay"
          hidden={!menuOpen}
          aria-hidden="true"
          onClick={handleCloseMenu}
        />
        <div className="creation-menu__drawer" id="creation-menu-drawer" hidden={!menuOpen}>
          <button className="btn btn--ghost" type="button" onClick={handleNewLetter}>
            Nova carta
          </button>
          <button
            className="btn btn--ghost"
            type="button"
            aria-expanded={draftsOpen}
            aria-controls="drafts-panel"
            onClick={handleToggleDrafts}
          >
            Rascunhos
          </button>
          <section
            className="drafts-panel"
            id="drafts-panel"
            aria-label="Rascunhos salvos"
            hidden={!draftsOpen}
          >
            {drafts.length === 0 ? (
              <p className="drafts-panel__empty">Nenhum rascunho salvo.</p>
            ) : (
              <ul className="drafts-panel__list">
                {drafts.map((record) => (
                  <li className="drafts-panel__item" key={record.id}>
                    <div className="drafts-panel__meta">
                      <strong>{record.draft.title || 'Carta sem título'}</strong>
                      <time dateTime={new Date(record.savedAt).toISOString()}>
                        {new Date(record.savedAt).toLocaleString('pt-BR')}
                      </time>
                    </div>
                    <div className="drafts-panel__actions">
                      <button type="button" onClick={() => handleLoadDraft(record)}>
                        Carregar
                      </button>
                      <button type="button" onClick={() => handleDeleteDraft(record.id)}>
                        Excluir
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {showAssetNotice && (
              <p className="drafts-panel__notice">
                Fotos e selo desenhado não voltam no rascunho; refaça-os se quiser.
              </p>
            )}
          </section>
        </div>
      </nav>

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
            <ShareBox url={shareUrl} writtenCount={writtenCount} />
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
                  photoCount={
                    (draft.assets?.length ?? 0) -
                    (draft.sealAssetId ? 1 : 0) +
                    pendingUploads
                  }
                  photoPreviews={photoPreviews}
                  onTitleChange={(value) => updateField('title', value)}
                  onMessageChange={(value) => updateField('message', value)}
                  onSignatureChange={(value) => updateField('signature', value)}
                  onPhotoFiles={(files, caret) => void handlePhotoFiles(files, caret)}
                  onRemovePhoto={handleRemovePhoto}
                />
              </section>

              <section className="form-card" aria-labelledby="personalization-heading">
                <h2 className="form-card__title" id="personalization-heading">
                  03 · O envelope
                </h2>
                <PersonalizationPanel
                  theme={draft.theme}
                  onThemeChange={updateTheme}
                  sealAssetId={draft.sealAssetId ?? null}
                  sealPreviewUrl={sealPreviewUrl}
                  onSealAssetChange={handleSealAssetChange}
                />
              </section>

              <section className="form-card" aria-labelledby="reading-heading">
                <h2 className="form-card__title" id="reading-heading">
                  04 · A leitura
                </h2>
                <div className="field">
                  <label className="field__label" htmlFor="read-time-limit">
                    Prazo de leitura
                  </label>
                  <select
                    id="read-time-limit"
                    value={draft.readTimeLimitSeconds ?? DEFAULT_READ_SECONDS}
                    onChange={(event) =>
                      updateOptions({ readTimeLimitSeconds: Number(event.target.value) })
                    }
                  >
                    {READ_TIME_OPTIONS.map((option) => (
                      <option key={option.seconds} value={option.seconds}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="field__hint">
                    Quem envia escolhe por quanto tempo a carta poderá ser lida.
                  </p>
                </div>
                <div className="checkbox-row">
                  <input
                    id="fade-enabled"
                    type="checkbox"
                    checked={draft.fadeEnabled ?? true}
                    onChange={(event) => updateOptions({ fadeEnabled: event.target.checked })}
                  />
                  <label htmlFor="fade-enabled">Apagar palavras durante a leitura</label>
                </div>
              </section>

              {errorMessage && (
                <p className="form-error" role="alert">
                  {errorMessage}
                </p>
              )}

              <div className="creation-form__actions">
                <button
                  className="btn btn--primary"
                  type="submit"
                  disabled={status === 'sending' || pendingUploads > 0}
                >
                  {status === 'sending'
                    ? 'Guardando…'
                    : pendingUploads > 0
                      ? 'Aguardando fotos…'
                      : 'Guardar carta'}
                </button>
                <button className="btn btn--ghost" type="button" onClick={handleSaveDraft}>
                  Salvar rascunho
                </button>
                {draftStatus && (
                  <p className="draft-status" role="status">
                    {draftStatus}
                  </p>
                )}
                {status === 'sending' && (
                  <p className="sending-note" role="status">
                    Guardando sua carta com cuidado…
                  </p>
                )}
                {pendingUploads > 0 && (
                  <p className="upload-note" aria-live="polite">
                    Enviando {pendingUploads} {pendingUploads === 1 ? 'foto' : 'fotos'}…
                  </p>
                )}
              </div>
            </form>
          )}

          <PreviewPane letter={previewLetter} resolveAsset={resolveAsset} />
        </div>
      </div>
    </main>
  );
}

export default CreationApp;
