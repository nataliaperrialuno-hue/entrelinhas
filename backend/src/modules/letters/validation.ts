import { z } from 'zod';

export const themeSchema = z.strictObject({
  envelope: z.enum(['classic', 'floral', 'minimal']),
  seal: z.enum(['wine', 'gold', 'ink']),
  palette: z.enum(['sepia', 'rose', 'night', 'sage']),
  typography: z.enum(['serif', 'hand', 'mono']),
  paper: z.enum(['linen', 'plain', 'aged']),
});

export const letterDraftSchema = z.strictObject({
  senderName: z.string().max(120),
  senderAnonymous: z.boolean(),
  recipientName: z.string().max(120),
  title: z.string().min(1).max(160),
  message: z.string().min(1).max(20000),
  signature: z.string().max(200),
  theme: themeSchema,
});

export const progressSchema = z.strictObject({
  progress: z.number().finite(),
});

export type ThemeSelection = z.infer<typeof themeSchema>;
export type LetterDraft = z.infer<typeof letterDraftSchema>;
