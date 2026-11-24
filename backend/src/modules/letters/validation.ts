import { z } from 'zod';

// Limite de 4000 palavras; teto de caracteres evita abuso no tamanho do corpo.
export const MAX_LETTER_WORDS = 4000;
export const MAX_LETTER_CHARS = 100000;

// Conta palavras separadas por whitespace (0 para texto vazio).
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).filter(Boolean).length;
}

export const themeSchema = z.strictObject({
  envelope: z.enum(['classic', 'floral', 'minimal']),
  seal: z.enum(['wine', 'gold', 'ink']),
  palette: z.enum(['sepia', 'rose', 'night', 'sage']),
  typography: z.enum(['serif', 'hand', 'mono']),
  paper: z.enum(['linen', 'plain', 'aged']),
  // Cor da tinta em #RRGGBB (hex de 6 dígitos).
  inkColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
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
});

export const progressSchema = z.strictObject({
  progress: z.number().finite(),
});

export type ThemeSelection = z.infer<typeof themeSchema>;
export type LetterDraft = z.infer<typeof letterDraftSchema>;
