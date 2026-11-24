import { useCallback, useState } from 'react';
import { DEFAULT_THEME } from '../../shared/themes';
import type { LetterDraft, ThemeSelection } from '../../shared/types';

export interface UseLetterDraftResult {
  draft: LetterDraft;
  updateField: <Key extends keyof LetterDraft>(field: Key, value: LetterDraft[Key]) => void;
  updateTheme: <Key extends keyof ThemeSelection>(field: Key, value: ThemeSelection[Key]) => void;
  setSenderAnonymous: (anonymous: boolean) => void;
  reset: () => void;
}

function createInitialDraft(): LetterDraft {
  return {
    senderName: '',
    senderAnonymous: false,
    recipientName: '',
    title: '',
    message: '',
    signature: '',
    theme: { ...DEFAULT_THEME },
  };
}

export function useLetterDraft(): UseLetterDraftResult {
  const [draft, setDraft] = useState<LetterDraft>(createInitialDraft);

  const updateField = useCallback(
    <Key extends keyof LetterDraft>(field: Key, value: LetterDraft[Key]): void => {
      setDraft((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const updateTheme = useCallback(
    <Key extends keyof ThemeSelection>(field: Key, value: ThemeSelection[Key]): void => {
      setDraft((current) => ({
        ...current,
        theme: { ...current.theme, [field]: value },
      }));
    },
    [],
  );

  const setSenderAnonymous = useCallback((anonymous: boolean): void => {
    setDraft((current) => ({
      ...current,
      senderAnonymous: anonymous,
      senderName: anonymous ? '' : current.senderName,
    }));
  }, []);

  const reset = useCallback((): void => {
    setDraft(createInitialDraft());
  }, []);

  return { draft, updateField, updateTheme, setSenderAnonymous, reset };
}

export default useLetterDraft;
