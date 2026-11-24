import express, { Router } from 'express';
import type { AppConfig } from '../../config';
import type { Db } from '../../db/client';
import { HttpError } from '../../middleware/error';
import { createRateLimiter } from '../../middleware/security';
import { readerToken } from '../../middleware/session';
import { getAssetForReading, uploadAsset } from './service';
import { assetUploadRequestSchema } from './validation';

function requiredParam(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  throw new HttpError(400, 'Parâmetro inválido.');
}

export function assetsRouter({ db, config }: { db: Db; config: AppConfig }): Router {
  const router = Router();

  // Corpo RAW: registrado no app ANTES do express.json global.
  router.post(
    '/api/assets',
    createRateLimiter(config),
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '2mb' }),
    (req, res) => {
      const parsed = assetUploadRequestSchema.safeParse({
        kind: req.get('x-asset-kind') ?? req.query.kind,
        contentType: req.get('content-type')?.split(';', 1)[0]?.trim() ?? req.query.contentType,
      });
      if (!parsed.success) {
        throw new HttpError(400, 'Dados inválidos.');
      }
      if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
        throw new HttpError(400, 'Arquivo ausente.');
      }

      res.status(201).json(
        uploadAsset(db, config, {
          kind: parsed.data.kind,
          contentType: parsed.data.contentType,
          bytes: req.body,
        }),
      );
    },
  );

  router.get('/api/assets/:id', createRateLimiter(config), (req, res) => {
    const asset = getAssetForReading(
      db,
      config,
      requiredParam(req.params.id),
      readerToken(req),
    );

    res.setHeader('Content-Type', asset.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store, private');
    res.send(Buffer.from(asset.data));
  });

  return router;
}
