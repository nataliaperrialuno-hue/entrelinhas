export type EnvelopeId = 'classic' | 'floral' | 'minimal';
export type SealId = 'wine' | 'gold' | 'ink';
export type PaletteId = 'sepia' | 'rose' | 'night' | 'sage';
export type TypographyId = 'serif' | 'hand' | 'mono';
export type PaperId = 'linen' | 'plain' | 'aged';

export interface ThemeSelection {
  envelope: EnvelopeId;
  seal: SealId;
  palette: PaletteId;
  typography: TypographyId;
  paper: PaperId;
  /** Opcional por retrocompatibilidade com cartas antigas. */
  inkColor?: string;
}

export interface LetterDraft {
  senderName: string;
  senderAnonymous: boolean;
  recipientName: string;
  title: string;
  message: string;
  signature: string;
  theme: ThemeSelection;
}

export interface LetterView {
  id: string;
  title: string;
  message: string;
  senderName: string | null;
  recipientName: string | null;
  signature: string | null;
  theme: ThemeSelection;
}

export interface ReadingState {
  state: 'opening' | 'reading' | 'completed' | 'expired' | 'invalidated';
  progress: number;
}

export interface CreateLetterResponse {
  url: string;
}
