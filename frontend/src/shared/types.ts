export type EnvelopeId = 'classic' | 'floral' | 'minimal';
export type SealId = 'wine' | 'gold' | 'ink' | 'custom';
export type PaletteId = 'sepia' | 'rose' | 'night' | 'sage';
export type TypographyId = 'serif' | 'hand' | 'mono';
export type PaperId = 'linen' | 'plain' | 'aged';

/** Referência persistida de um arquivo já aceito pelo servidor. */
export interface AssetRef {
  id: string;
  uploadToken: string;
}

/** Resultado do upload direto de um arquivo (mesma forma de `AssetRef`). */
export type AssetUploadResult = AssetRef;

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
  /** Opcional: cartas antigas apagam palavras por padrão na leitura. */
  fadeEnabled?: boolean;
  /** Opcional: 60..3600 segundos, escolhido por quem envia. */
  readTimeLimitSeconds?: number;
  /** Fotos e selo customizado enviados junto com a carta. */
  assets?: AssetRef[];
  /** Id do asset do selo desenhado pelo remetente. */
  sealAssetId?: string | null;
}

export interface LetterView {
  id: string;
  title: string;
  message: string;
  senderName: string | null;
  recipientName: string | null;
  signature: string | null;
  theme: ThemeSelection;
  /** Campos opcionais para não quebrar cartas e testes antigos. */
  fadeEnabled?: boolean;
  readDeadlineAt?: number | null;
  idleDeadlineAt?: number | null;
  sealAssetId?: string | null;
}

export interface ReadingState {
  state: 'opening' | 'reading' | 'completed' | 'expired' | 'invalidated';
  progress: number;
  readDeadlineAt?: number | null;
  idleDeadlineAt?: number | null;
  fadeEnabled?: boolean;
  sealAssetId?: string | null;
}

export interface CreateLetterResponse {
  url: string;
}
