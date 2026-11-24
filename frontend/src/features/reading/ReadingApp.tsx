import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  completeReading,
  getReadingState,
  openLetter,
  sendProgress,
} from '../../lib/api';
import { LetterSheet } from '../../shared/LetterSheet';
import type { LetterView } from '../../shared/types';
import { clamp } from '../fade/readingLine';
import { useFadeOnScroll } from '../fade/useFadeOnScroll';
import { EnvelopeStep } from './EnvelopeStep';
import { FinalMessage } from './FinalMessage';
import { NoticeStep } from './NoticeStep';
import './reading.css';

type Phase = 'loading' | 'notice' | 'envelope' | 'reading' | 'completed' | 'error';

const UNAVAILABLE_MESSAGE = 'Esta carta não está mais disponível.';
const GENERIC_ERROR_MESSAGE = 'Não foi possível carregar esta carta.';

interface ReadingAppProps {
  sessionId: string;
}

export function ReadingApp({ sessionId }: ReadingAppProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [letter, setLetter] = useState<LetterView | null>(null);
  const [savedProgress, setSavedProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const phaseRef = useRef<Phase>('loading');
  const requestIdRef = useRef(0);

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    try {
      const state = await getReadingState(sessionId);
      if (requestId !== requestIdRef.current) return;

      if (state.state === 'completed') {
        setSavedProgress(1);
        changePhase('completed');
        return;
      }

      if (state.state === 'expired' || state.state === 'invalidated') {
        setErrorMessage(UNAVAILABLE_MESSAGE);
        changePhase('error');
        return;
      }

      setSavedProgress(clamp(state.progress));

      const current = phaseRef.current;
      if (current === 'envelope' || current === 'reading' || current === 'completed') return;

      if (state.state === 'opening') {
        changePhase('notice');
        return;
      }

      // Abrir é idempotente no servidor; aqui serve para retomar uma leitura.
      const view = await openLetter(sessionId);
      if (requestId !== requestIdRef.current) return;
      setLetter(view);
      changePhase('reading');
    } catch (error: unknown) {
      if (requestId !== requestIdRef.current) return;
      const unavailable = error instanceof ApiError && error.status === 410;
      setErrorMessage(unavailable ? UNAVAILABLE_MESSAGE : GENERIC_ERROR_MESSAGE);
      changePhase('error');
    }
  }, [changePhase, sessionId]);

  useEffect(() => {
    const handlePageShow = (): void => {
      void load();
    };
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') void load();
    };

    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibility);
    void load();

    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [load]);

  const handleContinue = useCallback(() => {
    changePhase('envelope');
  }, [changePhase]);

  const handleOpen = useCallback(async () => {
    try {
      const view = await openLetter(sessionId);
      setLetter(view);
      changePhase('reading');
    } catch {
      setErrorMessage(GENERIC_ERROR_MESSAGE);
      changePhase('error');
    }
  }, [changePhase, sessionId]);

  const handleProgress = useCallback(
    (progress: number) => {
      void sendProgress(sessionId, progress).catch(() => {});
    },
    [sessionId],
  );

  const handleComplete = useCallback(() => {
    void completeReading(sessionId).catch(() => {});
    changePhase('completed');
  }, [changePhase, sessionId]);

  const attachSheet = useCallback((node: HTMLDivElement | null) => {
    sheetRef.current = node?.querySelector<HTMLElement>('[data-letter-sheet]') ?? null;
  }, []);

  useFadeOnScroll({
    scrollerRef,
    sheetRef,
    enabled: phase === 'reading' && letter !== null,
    sessionId,
    savedProgress,
    onProgress: handleProgress,
    onComplete: handleComplete,
  });

  if (phase === 'reading' && letter !== null) {
    return (
      <main className="reading-app reading-app--reading">
        <div className="letter-scroll" ref={scrollerRef}>
          <div className="reading-sheet-host" ref={attachSheet}>
            <LetterSheet letter={letter} />
          </div>
          <div data-reading-sentinel className="reading-sentinel" aria-hidden="true" />
        </div>
      </main>
    );
  }

  if (phase === 'notice') {
    return <NoticeStep onContinue={handleContinue} />;
  }

  if (phase === 'envelope') {
    return <EnvelopeStep onOpen={handleOpen} />;
  }

  if (phase === 'completed') {
    return <FinalMessage />;
  }

  if (phase === 'error') {
    return (
      <main className="reading-step reading-step--error">
        <section className="reading-step__card">
          <h1 className="reading-error__title">Não foi possível abrir esta carta</h1>
          <p className="reading-error__message">{errorMessage}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="reading-step reading-step--loading">
      <p className="reading-loading" role="status">
        Preparando sua leitura…
      </p>
    </main>
  );
}

export default ReadingApp;
