import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  assetUrl,
  completeReading,
  getReadingState,
  heartbeatReading,
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
const HEARTBEAT_INTERVAL_MS = 30_000;
const ACTIVITY_WINDOW_MS = 30_000;
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'scroll'] as const;

interface ReadingAppProps {
  sessionId: string;
}

interface DeadlineFields {
  readDeadlineAt?: number | null;
  idleDeadlineAt?: number | null;
}

interface ReadingMetadata extends DeadlineFields {
  fadeEnabled?: boolean;
  sealAssetId?: string | null;
}

function mergeDeadlines(source: DeadlineFields, current: DeadlineFields): DeadlineFields {
  return {
    readDeadlineAt:
      source.readDeadlineAt !== undefined ? source.readDeadlineAt : current.readDeadlineAt,
    idleDeadlineAt:
      source.idleDeadlineAt !== undefined ? source.idleDeadlineAt : current.idleDeadlineAt,
  };
}

function earliestDeadline(deadlines: DeadlineFields): number | null {
  const values = [deadlines.readDeadlineAt, deadlines.idleDeadlineAt].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  return values.length > 0 ? Math.min(...values) : null;
}

export function ReadingApp({ sessionId }: ReadingAppProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [letter, setLetter] = useState<LetterView | null>(null);
  const [savedProgress, setSavedProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [deadlines, setDeadlines] = useState<DeadlineFields>({});
  const [fadeEnabled, setFadeEnabled] = useState(true);
  const [sealAssetId, setSealAssetId] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const phaseRef = useRef<Phase>('loading');
  const requestIdRef = useRef(0);
  const lastActivityRef = useRef(0);
  const deadlineExpiredRef = useRef(false);

  const deadlineAt = earliestDeadline(deadlines);

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const showUnavailable = useCallback(() => {
    deadlineExpiredRef.current = true;
    setErrorMessage(UNAVAILABLE_MESSAGE);
    changePhase('error');
  }, [changePhase]);

  const applyMetadata = useCallback(
    (source: ReadingMetadata) => {
      setDeadlines((current) => mergeDeadlines(source, current));
      if (source.fadeEnabled !== undefined) setFadeEnabled(source.fadeEnabled);
      if (source.sealAssetId !== undefined) setSealAssetId(source.sealAssetId);
    },
    [],
  );

  const applyLetter = useCallback(
    (view: LetterView) => {
      setLetter(view);
      applyMetadata(view);
    },
    [applyMetadata],
  );

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (deadlineExpiredRef.current) {
      setErrorMessage(UNAVAILABLE_MESSAGE);
      changePhase('error');
      return;
    }

    try {
      const state = await getReadingState(sessionId);
      if (requestId !== requestIdRef.current || deadlineExpiredRef.current) return;

      applyMetadata(state);

      if (state.state === 'completed') {
        setSavedProgress(1);
        changePhase('completed');
        return;
      }

      if (state.state === 'expired' || state.state === 'invalidated') {
        showUnavailable();
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
      if (requestId !== requestIdRef.current || deadlineExpiredRef.current) return;
      applyLetter(view);
      changePhase('reading');
    } catch (error: unknown) {
      if (requestId !== requestIdRef.current) return;
      const unavailable = error instanceof ApiError && error.status === 410;
      if (unavailable) showUnavailable();
      else {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
        changePhase('error');
      }
    }
  }, [applyLetter, applyMetadata, changePhase, sessionId, showUnavailable]);

  useEffect(() => {
    deadlineExpiredRef.current = false;
    lastActivityRef.current = 0;

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

  useEffect(() => {
    if (phase !== 'reading' || deadlineAt === null) return;

    const timer = window.setTimeout(() => {
      showUnavailable();
      void load();
    }, Math.max(0, deadlineAt - Date.now()));

    return () => window.clearTimeout(timer);
  }, [deadlineAt, load, phase, showUnavailable]);

  useEffect(() => {
    if (phase !== 'reading') return;

    const markActivity = (): void => {
      lastActivityRef.current = Date.now();
    };
    const options: AddEventListenerOptions = { capture: true, passive: true };

    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, markActivity, options);

    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, markActivity, options);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'reading') return;

    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivityRef.current > ACTIVITY_WINDOW_MS) return;

      void heartbeatReading(sessionId)
        .then((response) => {
          applyMetadata(response);
          if (response.state === 'completed') {
            changePhase('completed');
            return;
          }
          if (response.state === 'expired' || response.state === 'invalidated') {
            showUnavailable();
            void load();
          }
        })
        .catch(() => {
          void load();
        });
    }, HEARTBEAT_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [applyMetadata, changePhase, load, phase, sessionId, showUnavailable]);

  const handleContinue = useCallback(() => {
    changePhase('envelope');
  }, [changePhase]);

  const handleOpen = useCallback(async () => {
    if (deadlineExpiredRef.current) {
      showUnavailable();
      return;
    }

    try {
      const view = await openLetter(sessionId);
      if (deadlineExpiredRef.current) {
        showUnavailable();
        return;
      }
      applyLetter(view);
      changePhase('reading');
    } catch (error: unknown) {
      if (deadlineExpiredRef.current) {
        showUnavailable();
        return;
      }
      const unavailable = error instanceof ApiError && error.status === 410;
      if (unavailable) showUnavailable();
      else {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
        changePhase('error');
      }
    }
  }, [applyLetter, changePhase, sessionId, showUnavailable]);

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
    fadeEnabled,
    onProgress: handleProgress,
    onComplete: handleComplete,
  });

  if (phase === 'reading' && letter !== null) {
    return (
      <main className="reading-app reading-app--reading">
        <div className="letter-scroll" ref={scrollerRef}>
          <div className="reading-sheet-host" ref={attachSheet}>
            <LetterSheet letter={letter} resolveAsset={(id) => assetUrl(id)} />
          </div>
          <div data-reading-sentinel className="reading-sentinel" aria-hidden="true" />
        </div>
      </main>
    );
  }

  if (phase === 'notice') {
    return <NoticeStep fadeEnabled={fadeEnabled} onContinue={handleContinue} />;
  }

  if (phase === 'envelope') {
    return (
      <EnvelopeStep
        theme={letter?.theme}
        sealAssetId={sealAssetId}
        onOpen={handleOpen}
      />
    );
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
