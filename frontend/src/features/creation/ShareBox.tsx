import { useMemo, useRef, useState } from 'react';

interface ShareBoxProps {
  url: string;
  message?: string;
}

type CopyState = 'idle' | 'copied' | 'error';

const DEFAULT_SHARE_MESSAGE = 'Recebi uma carta pelo Entrelinhas. Leia aqui: ';

export function ShareBox({ url, message = DEFAULT_SHARE_MESSAGE }: ShareBoxProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const absoluteUrl = useMemo(() => new URL(url, window.location.origin).toString(), [url]);
  const whatsappHref = useMemo(
    () => `https://wa.me/?text=${encodeURIComponent(message + absoluteUrl)}`,
    [absoluteUrl, message],
  );

  async function handleCopy(): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(absoluteUrl);
      } else {
        const input = inputRef.current;
        if (!input) {
          throw new Error('Campo de link indisponível.');
        }
        input.focus();
        input.select();
        const copied = document.execCommand('copy');
        if (!copied) {
          throw new Error('Não foi possível copiar o link.');
        }
      }
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  const statusText =
    copyState === 'copied'
      ? 'Link copiado. Você já pode enviá-lo.'
      : copyState === 'error'
        ? 'Não foi possível copiar. Selecione o link acima e copie manualmente.'
        : '';

  return (
    <section className="share-box" aria-labelledby="share-heading">
      <h2 className="share-box__title" id="share-heading">
        Sua carta foi guardada
      </h2>
      <p className="share-box__lead">
        Entregue este link a quem deve lê-lo. Ele é a única chave para abrir a carta.
      </p>

      <div className="share-box__link">
        <label className="sr-only" htmlFor="share-url">
          Link da carta
        </label>
        <input
          id="share-url"
          ref={inputRef}
          type="text"
          readOnly
          value={absoluteUrl}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button className="btn btn--ghost" type="button" onClick={() => void handleCopy()}>
          Copiar link
        </button>
      </div>
      <p className="share-box__status" role="status">
        {statusText}
      </p>

      <div className="share-box__actions">
        <a className="btn btn--primary" href={whatsappHref} target="_blank" rel="noreferrer">
          Compartilhar no WhatsApp
        </a>
      </div>

      <p className="share-box__warning" role="note">
        Este link só pode ser usado uma vez. Depois que a carta for aberta, ela se encerra para
        sempre.
      </p>
    </section>
  );
}

export default ShareBox;
