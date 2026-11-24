import express from 'express';
import type { Express } from 'express';
import type { AppConfig } from './config';
import type { Db } from './db/client';
import { errorHandler } from './middleware/error';
import { noStoreForReading, securityHeaders } from './middleware/security';
import { sessionCookieMiddleware } from './middleware/session';
import { lettersRouter } from './modules/letters/routes';
import { readingRouter } from './modules/reading/routes';

export function createApp({ db, config }: { db: Db; config: AppConfig }): Express {
  const app = express();

  app.use(securityHeaders);
  app.use(noStoreForReading);
  app.use(express.json({ limit: '32kb' }));
  app.use(sessionCookieMiddleware(config));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(lettersRouter({ db, config }));
  app.use(readingRouter({ db, config }));

  app.use(errorHandler);

  return app;
}
