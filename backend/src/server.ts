import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { expireStale } from './modules/reading/service';

const config = loadConfig();
const backendRoot = dirname(fileURLToPath(import.meta.url));
const dataDir = join(backendRoot, 'data');

mkdirSync(dataDir, { recursive: true });

const db = createDb(join(dataDir, 'entrelinhas.db'));
const app = createApp({ db, config });

expireStale(db, config);

const expirationTimer = setInterval(() => {
  try {
    expireStale(db, config);
  } catch (error) {
    console.error('Falha ao executar a limpeza de registros expirados:', error);
  }
}, 60_000);
expirationTimer.unref();

if (config.nodeEnv === 'production') {
  const frontendDist = join(backendRoot, '..', 'frontend', 'dist');

  // Mantém o Cache-Control definido para /leitura/* também nos arquivos estáticos.
  app.use(express.static(frontendDist, { cacheControl: false }));
  app.get(/.*/, (_req, res) => {
    res.sendFile(join(frontendDist, 'index.html'), { cacheControl: false });
  });
}

app.listen(config.port);
