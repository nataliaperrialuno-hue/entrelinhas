import { Router } from 'express';
import type { AppConfig } from '../../config';
import type { Db } from '../../db/client';
import { HttpError } from '../../middleware/error';
import { createRateLimiter } from '../../middleware/security';
import { readerToken, setReaderCookie } from '../../middleware/session';
import { progressSchema } from '../letters/validation';
import {
  claimReading,
  completeReading,
  getReadingState,
  openReading,
  updateProgress,
} from './service';

function requiredParam(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  throw new HttpError(400, 'Parâmetro inválido.');
}

export function readingRouter({ db, config }: { db: Db; config: AppConfig }): Router {
  const router = Router();

  router.get('/c/:linkToken', createRateLimiter(config), (req, res) => {
    const result = claimReading(
      db,
      config,
      requiredParam(req.params.linkToken),
      readerToken(req),
    );

    if (result.readerToken !== null) {
      setReaderCookie(res, config, result.readerToken);
    }

    res.redirect(302, result.location);
  });

  router.get('/api/read/:sessionId/state', (req, res) => {
    res.json(
      getReadingState(
        db,
        config,
        requiredParam(req.params.sessionId),
        readerToken(req),
      ),
    );
  });

  router.post('/api/read/:sessionId/open', createRateLimiter(config), (req, res) => {
    res.json(
      openReading(db, config, requiredParam(req.params.sessionId), readerToken(req)),
    );
  });

  router.post('/api/read/:sessionId/progress', (req, res) => {
    const parsed = progressSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Dados inválidos.');
    }

    res.json(
      updateProgress(
        db,
        config,
        requiredParam(req.params.sessionId),
        readerToken(req),
        parsed.data.progress,
      ),
    );
  });

  router.post('/api/read/:sessionId/complete', createRateLimiter(config), (req, res) => {
    res.json(
      completeReading(db, config, requiredParam(req.params.sessionId), readerToken(req)),
    );
  });

  return router;
}
