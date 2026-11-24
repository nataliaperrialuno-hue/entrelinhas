import express from 'express';
import helmet from 'helmet';
import type { Express, NextFunction, Request, Response } from 'express';
import type { AppConfig } from './config';
import type { Db } from './db/client';

export function createApp({ db, config }: { db: Db; config: AppConfig }): Express {
  const app = express();

  // Dependências mantidas disponíveis para os módulos de domínio registrarem rotas.
  void db;
  void config;

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Rotas adicionadas pelos módulos letters/reading

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Detalhes do erro não são expostos ao cliente.
    void err;
    if (res.headersSent) {
      return;
    }
    res.status(500).json({ error: 'Erro interno' });
  });

  return app;
}
