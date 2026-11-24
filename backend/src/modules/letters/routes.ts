import { Router } from 'express';
import type { AppConfig } from '../../config';
import type { Db } from '../../db/client';
import { HttpError } from '../../middleware/error';
import { createRateLimiter } from '../../middleware/security';
import { createLetter } from './service';
import { letterDraftSchema } from './validation';

export function lettersRouter({ db, config }: { db: Db; config: AppConfig }): Router {
  const router = Router();

  router.post('/api/letters', createRateLimiter(config), (req, res) => {
    const parsed = letterDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Dados inválidos.');
    }

    res.status(201).json(createLetter(db, config, parsed.data));
  });

  return router;
}
