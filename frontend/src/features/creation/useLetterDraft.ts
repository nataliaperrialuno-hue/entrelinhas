import { useCallback, useRef, useState } from 'react';
import { assetUrl } from '../../lib/api';
import { DEFAULT_READ_SECONDS } from '../../shared/limits';
import { DEFAULT_THEME } from '../../shared/themes';
import type { AssetRef, LetterDraft, ThemeSelection } from '../../shared/types';

type DraftOptions = Partial<
  Pick<LetterDraft, 'fadeEnabled' | 'readTimeLimitSeconds' | 'sealAssetId'>
>;

export interface UseLetterDraftResult {
  draft: LetterDraft;
  updateField: <Key extends keyof LetterDraft>(field: Key, value: LetterDraft[Key]) => void;
  updateMessageFrom: (updater: (message: string) => string) => void;
  updateTheme: <Key extends keyof ThemeSelection>(field: Key, value: ThemeSelection[Key]) => void;
  setSenderAnonymous: (anonymous: boolean) => void;
  updateOptions: (options: DraftOptions) => void;
  addAsset: (asset: AssetRef) => void;
  removeAsset: (id: string) => void;
  registerPreviewUrl: (id: string, url: string) => void;
  getPreviewUrl: (id: string) => string | null;
  revokePreviewUrl: (id: string) => void;
  resolveAsset: (id: string) => string | null;
  /** Substitui o draft atual (ex.: rascunho restaurado), revogando prévia antiga. */
  applyDraft: (next: LetterDraft) => void;
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
    fadeEnabled: true,
    readTimeLimitSeconds: DEFAULT_READ_SECONDS,
    assets: [],
    sealAssetId: null,
  };
}

export function useLetterDraft(): UseLetterDraftResult {
  const [draft, setDraft] = useState<LetterDraft>(createInitialDraft);
  const previewUrlsRef = useRef<Map<string, string>>(new Map());

  const revokePreviewUrl = useCallback((id: string): void => {
    const current = previewUrlsRef.current.get(id);
    if (current !== undefined) {
      URL.revokeObjectURL(current);
      previewUrlsRef.current.delete(id);
    }
  }, []);

  const registerPreviewUrl = useCallback(
    (id: string, url: string): void => {
      revokePreviewUrl(id);
      previewUrlsRef.current.set(id, url);
    },
    [revokePreviewUrl],
  );

  const getPreviewUrl = useCallback((id: string): string | null => {
    return previewUrlsRef.current.get(id) ?? null;
  }, []);

  const updateField = useCallback(
    <Key extends keyof LetterDraft>(field: Key, value: LetterDraft[Key]): void => {
      setDraft((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  /** Atualização funcional da mensagem: segura mesmo com uploads concorrentes. */
  const updateMessageFrom = useCallback((updater: (message: string) => string): void => {
    setDraft((current) => ({ ...current, message: updater(current.message) }));
  }, []);

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

  const updateOptions = useCallback((options: DraftOptions): void => {
    setDraft((current) => ({ ...current, ...options }));
  }, []);

  const addAsset = useCallback((asset: AssetRef): void => {
    setDraft((current) => ({ ...current, assets: [...(current.assets ?? []), asset] }));
  }, []);

  const removeAsset = useCallback(
    (id: string): void => {
      setDraft((current) => ({
        ...current,
        assets: (current.assets ?? []).filter((item) => item.id !== id),
        sealAssetId: current.sealAssetId === id ? null : current.sealAssetId,
      }));
      revokePreviewUrl(id);
    },
    [revokePreviewUrl],
  );

  const resolveAsset = useCallback(
    (id: string): string | null => {
      const preview = previewUrlsRef.current.get(id);
      if (preview !== undefined) return preview;
      return (draft.assets ?? []).some((item) => item.id === id) ? assetUrl(id) : null;
    },
    [draft.assets],
  );

  /** Toda troca completa de draft libera as object URLs das prévias anteriores. */
  const replaceDraft = useCallback((next: LetterDraft): void => {
    for (const url of previewUrlsRef.current.values()) URL.revokeObjectURL(url);
    previewUrlsRef.current.clear();
    setDraft({ ...next, theme: { ...next.theme } });
  }, []);

  const applyDraft = useCallback(
    (next: LetterDraft): void => {
      replaceDraft(next);
    },
    [replaceDraft],
  );

  const reset = useCallback((): void => {
    replaceDraft(createInitialDraft());
  }, [replaceDraft]);

  return {
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
  };
}

export default useLetterDraft;
