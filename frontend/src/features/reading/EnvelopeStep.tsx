import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnimationEvent } from 'react';
import { assetUrl } from '../../lib/api';
import type { ThemeSelection } from '../../shared/types';

interface EnvelopeStepProps {
  onOpen: () => void;
  theme?: ThemeSelection;
  sealAssetId?: string | null;
}

const OPEN_FALLBACK_MS = 900;

function WaxSeal() {
  return (
    <span className="wax-seal" aria-hidden="true">
      <span className="wax-seal__rim" />
      <span className="wax-seal__face">
        <svg className="wax-seal__glyph" viewBox="0 0 48 48" focusable="false">
          <path
            d="M10 17h28v18H10z M10 17l14 11 14-11"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </span>
  );
}

function CustomSeal({ assetId }: { assetId: string | null }) {
  return (
    <span className="wax-seal wax-seal--custom" aria-hidden="true">
      <span className="wax-seal__rim" />
      <span className="wax-seal__face">
        {assetId !== null ? (
          <img className="wax-seal__image" src={assetUrl(assetId)} alt="" />
        ) : null}
      </span>
    </span>
  );
}

export function EnvelopeStep({ onOpen, theme, sealAssetId }: EnvelopeStepProps) {
  const [opening, setOpening] = useState(false);
  const openedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    onOpen();
  }, [onOpen]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleClick = (): void => {
    if (openedRef.current) return;
    setOpening(true);

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (reducedMotion) {
      open();
      return;
    }

    timerRef.current = setTimeout(open, OPEN_FALLBACK_MS);
  };

  const handleAnimationEnd = (event: AnimationEvent<HTMLButtonElement>): void => {
    if (event.target !== event.currentTarget) return;
    open();
  };

  const customAssetId =
    sealAssetId !== null && sealAssetId !== undefined && sealAssetId.length > 0
      ? sealAssetId
      : null;
  const useCustomSeal = theme?.seal === 'custom' || (theme === undefined && customAssetId !== null);

  return (
    <main className="reading-step reading-step--envelope">
      <div className={`envelope-stage ${opening ? 'is-opening' : ''}`}>
        <div className="envelope" aria-hidden="true">
          <div className="envelope__paper" />
          <div className="envelope__flap" />
          <div className="envelope__fold envelope__fold--left" />
          <div className="envelope__fold envelope__fold--right" />
          <div className="envelope__fold envelope__fold--bottom" />
          <div className="envelope__seam" />
          <div className="envelope__letter" />
        </div>
        <button
          type="button"
          className="envelope-stage__seal-button"
          aria-label="Abrir carta"
          onClick={handleClick}
          onAnimationEnd={handleAnimationEnd}
        >
          {useCustomSeal ? <CustomSeal assetId={customAssetId} /> : <WaxSeal />}
        </button>
      </div>
      <p className="envelope-step__hint">Clique no selo para abrir.</p>
    </main>
  );
}

export default EnvelopeStep;
