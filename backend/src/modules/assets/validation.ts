import { z } from 'zod';

/** Decisão do usuário: até 3 fotos de 2 MiB cada. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
/** Selo desenhado: PNG/WebP de até 16 KiB. */
export const MAX_SEAL_BYTES = 16 * 1024;

export const assetKindSchema = z.enum(['photo', 'seal']);
export const assetContentTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp']);

export const assetUploadRequestSchema = z.strictObject({
  kind: assetKindSchema,
  contentType: assetContentTypeSchema,
});

export type AssetKind = z.infer<typeof assetKindSchema>;
export type AssetContentType = z.infer<typeof assetContentTypeSchema>;
