import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';

const config = loadConfig();
const backendRoot = dirname(fileURLToPath(import.meta.url));
const dataDir = join(backendRoot, 'data');

mkdirSync(dataDir, { recursive: true });

const db = createDb(join(dataDir, 'entrelinhas.db'));
const app = createApp({ db, config });

if (config.nodeEnv === 'production') {
  const frontendDist = join(backendRoot, '..', 'frontend', 'dist');
  app.use(express.static(frontendDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(join(frontendDist, 'index.html'));
  });
}

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Entrelinhas API ouvindo na porta ${config.port}`);
});
