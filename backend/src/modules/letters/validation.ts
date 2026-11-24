import { z } from 'zod';

// Limite de 4000 palavras; teto de caracteres evita abuso no tamanho do corpo.
export const MAX_LETTER_WORDS = 4000;
export const MAX_LETTER_CHARS = 100000;
export const MAX_PHOTOS = 3;
export const MAX_SEAL_ASSETS = 1;
export const MAX_ASSETS = MAX_PHOTOS + MAX_SEAL_ASSETS;
export const PHOTO_MARKER_PATTERN = /\[\[foto:([^\]]+)\]\]/g;
export const PHOTO_MARKER_PREFIX = '[[foto:';

// Conta palavras separadas por whitespace (0 para texto vazio).
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).filter(Boolean).length;
}

export const themeSchema = z.strictObject({
  envelope: z.enum(['classic', 'floral', 'minimal']),
  seal: z.enum(['wine', 'gold', 'ink', 'custom']),
  palette: z.enum(['sepia', 'rose', 'night', 'sage']),
  typography: z.enum(['serif', 'hand', 'mono']),
  paper: z.enum(['linen', 'plain', 'aged']),
  // Cor da tinta em #RRGGBB (hex de 6 dígitos). Opcional para cartas antigas.
  inkColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const assetReferenceSchema = z.strictObject({
  id: z.uuid(),
  uploadToken: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

export const letterDraftSchema = z.strictObject({
  senderName: z.string().max(120),
  senderAnonymous: z.boolean(),
  recipientName: z.string().max(120),
  title: z.string().min(1).max(160),
  message: z
    .string()
    .min(1)
    .max(MAX_LETTER_CHARS)
    .refine((value) => countWords(value) <= MAX_LETTER_WORDS, {
      message: `A carta pode ter no máximo ${MAX_LETTER_WORDS} palavras.`,
    }),
  signature: z.string().max(200),
  theme: themeSchema,
  fadeEnabled: z.boolean().default(true),
  readTimeLimitSeconds: z.number().int().min(60).max(3600).optional(),
  assets: z.array(assetReferenceSchema).max(MAX_ASSETS).optional(),
  sealAssetId: z.uuid().nullable().optional(),
});

/** Nenhuma rota de leitura aceita opções do leitor. */
export const emptyBodySchema = z.strictObject({});

export const progressSchema = z.strictObject({
  progress: z.number().finite(),
});

/** Tipo de entrada (o que o cliente envia): opções ausentes são permitidas. */
export type LetterDraft = z.input<typeof letterDraftSchema>;
export type ParsedLetterDraft = z.output<typeof letterDraftSchema>;
export type ThemeSelection = z.infer<typeof themeSchema>;
export type AssetReference = z.infer<typeof assetReferenceSchema>;
