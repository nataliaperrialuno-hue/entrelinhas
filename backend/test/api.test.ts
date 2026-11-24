import type { Express } from 'express';
import type { Response } from 'supertest';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';
import { loadConfig } from '../src/config';
import { createDb, type Db } from '../src/db/client';
import type { LetterDraft } from '../src/modules/letters/validation';
import { expireStale } from '../src/modules/reading/service';
import { generateToken, hashToken, tokensEqual } from '../src/utils/tokens';

const SECRET = 'secret-de-teste-com-pelo-menos-32-bytes';

function testConfig(): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    TOKEN_HMAC_SECRET: SECRET,
    LETTER_TTL_DAYS: '30',
    SESSION_GRACE_MINUTES: '10',
    IDLE_TIMEOUT_SECONDS: '600',
    DEFAULT_READ_TIME_LIMIT_SECONDS: '600',
    HEARTBEAT_TTL_SECONDS: '120',
    RATE_LIMIT_MAX: '1000',
    RATE_LIMIT_WINDOW_MS: '60000',
  });
}

function validDraft(): LetterDraft {
  return {
    senderName: 'Ana',
    senderAnonymous: false,
    recipientName: 'Bia',
    title: 'Uma carta',
    message: 'Mensagem confidencial de leitura única.',
    signature: 'Ana',
    theme: {
      envelope: 'floral',
      seal: 'wine',
      palette: 'sepia',
      typography: 'serif',
      paper: 'linen',
    },
  };
}

function sessionIdFrom(response: Response): string {
  const location = response.headers.location;
  if (typeof location !== 'string' || !location.startsWith('/leitura/')) {
    throw new Error('Redirect de leitura ausente');
  }

  return location.slice('/leitura/'.length);
}

function cookiePairFrom(response: Response): string {
  const header = response.headers['set-cookie'];
  const first = Array.isArray(header) ? header[0] : header;
  if (typeof first !== 'string') {
    throw new Error('Set-Cookie ausente');
  }

  const pair = first.split(';', 1)[0];
  if (pair === undefined) {
    throw new Error('Set-Cookie inválido');
  }

  return pair;
}

function rawTokenFrom(cookiePair: string): string {
  const separator = cookiePair.indexOf('=');
  return cookiePair.slice(separator + 1);
}

async function createLetter(app: Express): Promise<string> {
  const response = await request(app).post('/api/letters').send(validDraft());
  expect(response.status).toBe(201);
  const url = response.body.url as string;
  expect(url.startsWith('/c/')).toBe(true);
  return url.slice('/c/'.length);
}

function pngBytes(width = 8, height = 8): Buffer {
  const bytes = Buffer.alloc(25);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** PNG válido no cabeçalho com payload preenchido até o tamanho desejado. */
function pngOfSize(totalBytes: number): Buffer {
  const bytes = Buffer.alloc(totalBytes);
  pngBytes().copy(bytes, 0);
  return bytes;
}

function jpegBytes(width = 8, height = 8): Buffer {
  const bytes = Buffer.alloc(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0], 0);
  bytes.writeUInt16BE(17, 4);
  bytes[6] = 8;
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

function webpBytes(width = 8, height = 8): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32BE(22, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.write('VP8X', 12, 'ascii');
  bytes.writeUInt32BE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

async function upload(
  app: Express,
  kind: 'photo' | 'seal',
  bytes: Buffer,
  mime = 'image/png',
): Promise<{ id: string; uploadToken: string }> {
  const response = await request(app)
    .post('/api/assets')
    .set('Content-Type', mime)
    .set('x-asset-kind', kind)
    .send(bytes);

  expect(response.status).toBe(201);
  return response.body as { id: string; uploadToken: string };
}

function letterWithPhoto(asset: { id: string; uploadToken: string }) {
  return {
    ...validDraft(),
    message: `Olha a foto: [[foto:${asset.id}]]`,
    theme: { ...validDraft().theme, seal: 'custom' as const },
    assets: [asset],
    sealAssetId: null,
  };
}

let db: Db;
let app: Express;
let config: AppConfig;

function one<T>(sql: string, ...params: (string | number)[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

beforeEach(() => {
  config = testConfig();
  db = createDb(':memory:');
  app = createApp({ db, config });
});

afterEach(() => {
  db.close();
});

describe('tokens e HMAC', () => {
  it('gera 256 bits e compara hashes em tempo constante', () => {
    const first = generateToken();
    const second = generateToken();

    expect(first).not.toBe(second);
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(hashToken(first, SECRET)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokensEqual(hashToken(first, SECRET), hashToken(first, SECRET))).toBe(true);
    expect(tokensEqual(hashToken(first, SECRET), hashToken(second, SECRET))).toBe(false);
    expect(tokensEqual('não-hex', '0000')).toBe(false);
  });
});

describe('API de cartas', () => {
  it('expõe health', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('cria uma carta sem persistir o token cru', async () => {
    const token = await createLetter(app);

    const row = one<{ token_hash: string }>(
      'SELECT token_hash FROM letters',
    );
    expect(row?.token_hash).toBe(hashToken(token, SECRET));
    expect(row?.token_hash).not.toBe(token);

    const dump = db.prepare('SELECT * FROM letters').all() as unknown[];
    expect(JSON.stringify(dump)).not.toContain(token);
  });

  it('rejeita título vazio e tema inválido com 400', async () => {
    const emptyTitle = { ...validDraft(), title: '' };
    const invalidTheme = {
      ...validDraft(),
      theme: { ...validDraft().theme, palette: 'neon' },
    } as unknown as LetterDraft;

    expect((await request(app).post('/api/letters').send(emptyTitle)).status).toBe(400);
    expect((await request(app).post('/api/letters').send(invalidTheme)).status).toBe(400);
  });

  it('rejeita campos extras por causa do strict', async () => {
    const extra = { ...validDraft(), injected: 'não permitido' };

    expect((await request(app).post('/api/letters').send(extra)).status).toBe(400);
  });

  it('aceita carta com exatamente 6000 palavras', async () => {
    const message = Array.from({ length: 6000 }, (_, i) => `palavra${i}`).join(' ');
    expect(message.length).toBeLessThan(100_000);
    expect(Buffer.byteLength(message, 'utf8')).toBeLessThan(512 * 1024);

    const creation = await request(app)
      .post('/api/letters')
      .send({ ...validDraft(), message });

    expect(creation.status).toBe(201);
  });

  it('rejeita carta com 6001 palavras com 400', async () => {
    const message = Array.from({ length: 6001 }, (_, i) => `palavra${i}`).join(' ');
    expect(message.length).toBeLessThan(100_000);
    expect(Buffer.byteLength(message, 'utf8')).toBeLessThan(512 * 1024);

    const creation = await request(app)
      .post('/api/letters')
      .send({ ...validDraft(), message });

    expect(creation.status).toBe(400);
    // Erro genérico é contrato estável; o limite é explicado pela validação local do frontend.
    expect(creation.body).toEqual({ error: 'Dados inválidos.' });
  });

  it('marca remetente anônimo e não devolve o nome', async () => {
    const anonymous = { ...validDraft(), senderName: 'Ana', senderAnonymous: true };
    const creation = await request(app).post('/api/letters').send(anonymous);
    const token = (creation.body.url as string).slice('/c/'.length);
    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);

    const opened = await request(app)
      .post(`/api/read/${sessionId}/open`)
      .set('Cookie', cookie);

    expect(opened.status).toBe(200);
    expect(opened.body.senderName).toBeNull();
  });
});

describe('claim e sessão de leitura', () => {
  it('cria sessão com cookie e bloqueia novo claim após o fim da carência', async () => {
    const token = await createLetter(app);
    const first = await request(app).get(`/c/${token}`);

    expect(first.status).toBe(302);
    expect(first.headers.location).toMatch(/^\/leitura\//);
    expect(first.headers['set-cookie']).toBeDefined();

    const sessionId = sessionIdFrom(first);
    const cookie = cookiePairFrom(first);
    const session = one<{
      state: string;
      epoch: number;
      token_hash: string;
    }>('SELECT state, epoch, token_hash FROM sessions WHERE id = ?', sessionId);

    expect(session?.state).toBe('opening');
    expect(session?.epoch).toBe(0);
    expect(session?.token_hash).toBe(
      hashToken(rawTokenFrom(cookie), SECRET),
    );
    expect(session?.token_hash).not.toBe(rawTokenFrom(cookie));
    expect(cookie).toMatch(/^entrelinhas_read=/);
    expect(first.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('HttpOnly')]),
    );

    db.prepare('UPDATE sessions SET grace_until = ? WHERE id = ?')
      .run(Date.now() - 1, sessionId);

    const second = await request(app).get(`/c/${token}`);
    expect([409, 410]).toContain(second.status);
    expect(second.body).toEqual({ error: 'Esta carta não está mais disponível.' });
  });

  it('não expõe conteúdo em /state nem antes do /open', async () => {
    const token = await createLetter(app);
    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);

    const state = await request(app)
      .get(`/api/read/${sessionId}/state`)
      .set('Cookie', cookie);

    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      state: 'opening',
      progress: 0,
      fadeEnabled: true,
      readDeadlineAt: expect.any(Number),
      idleDeadlineAt: expect.any(Number),
      sealAssetId: null,
    });
    expect(JSON.stringify(state.body)).not.toContain(validDraft().message);

    const unauthorized = await request(app).post(`/api/read/${sessionId}/open`);
    expect(unauthorized.status).toBe(401);
  });

  it('entrega a carta apenas em /open, de forma idempotente', async () => {
    const draft = validDraft();
    const token = await createLetter(app);
    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);

    const opened = await request(app)
      .post(`/api/read/${sessionId}/open`)
      .set('Cookie', cookie);

    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({
      id: expect.any(String),
      title: draft.title,
      message: draft.message,
      senderName: draft.senderName,
      recipientName: draft.recipientName,
      signature: draft.signature,
      theme: draft.theme,
    });

    const session = one<{ state: string; epoch: number }>(
      'SELECT state, epoch FROM sessions WHERE id = ?',
      sessionId,
    );
    const letter = one<{ state: string }>(
      'SELECT state FROM letters',
    );
    expect(session?.state).toBe('reading');
    expect(session?.epoch).toBe(1);
    expect(letter?.state).toBe('reading');

    const again = await request(app)
      .post(`/api/read/${sessionId}/open`)
      .set('Cookie', cookie);

    expect(again.status).toBe(200);
    expect(again.body.message).toBe(draft.message);
    const epoch = one<{ epoch: number }>(
      'SELECT epoch FROM sessions WHERE id = ?',
      sessionId,
    );
    expect(epoch?.epoch).toBe(1);
  });

  it('aceita apenas progresso monotônico dentro de [0, 1]', async () => {
    const token = await createLetter(app);
    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);

    await request(app).post(`/api/read/${sessionId}/open`).set('Cookie', cookie);

    const first = await request(app)
      .post(`/api/read/${sessionId}/progress`)
      .set('Cookie', cookie)
      .send({ progress: 0.4 });
    expect(first.body.progress).toBeCloseTo(0.4);

    const lower = await request(app)
      .post(`/api/read/${sessionId}/progress`)
      .set('Cookie', cookie)
      .send({ progress: 0.2 });
    expect(lower.body.progress).toBeCloseTo(0.4);

    const above = await request(app)
      .post(`/api/read/${sessionId}/progress`)
      .set('Cookie', cookie)
      .send({ progress: 5 });
    expect(above.body.progress).toBe(1);

    const below = await request(app)
      .post(`/api/read/${sessionId}/progress`)
      .set('Cookie', cookie)
      .send({ progress: -5 });
    expect(below.body.progress).toBe(1);
  });

  it('conclui de forma idempotente e apaga o plaintext', async () => {
    const token = await createLetter(app);
    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);

    await request(app).post(`/api/read/${sessionId}/open`).set('Cookie', cookie);

    const done = await request(app)
      .post(`/api/read/${sessionId}/complete`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `${sessionId}:complete`);
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ state: 'completed' });

    const row = one<{
      state: string;
      title: string;
      message: string;
      signature: string | null;
      sender_name: string | null;
      recipient_name: string | null;
    }>(`SELECT state, title, message, signature, sender_name, recipient_name
          FROM letters`);
    expect(row?.state).toBe('completed');
    expect(row?.title).toBe('');
    expect(row?.message).toBe('');
    expect(row?.signature).toBeNull();
    expect(row?.sender_name).toBeNull();
    expect(row?.recipient_name).toBeNull();

    const repeated = await request(app)
      .post(`/api/read/${sessionId}/complete`)
      .set('Cookie', cookie);
    expect(repeated.status).toBe(200);
    expect(repeated.body).toEqual({ state: 'completed' });

    const state = await request(app)
      .get(`/api/read/${sessionId}/state`)
      .set('Cookie', cookie);
    expect(state.body.state).toBe('completed');
  });

  it('retoma a mesma sessão quando o cookie é apresentado', async () => {
    const token = await createLetter(app);
    const first = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(first);
    const sessionId = sessionIdFrom(first);

    const resumed = await request(app).get(`/c/${token}`).set('Cookie', cookie);

    expect(resumed.status).toBe(302);
    expect(sessionIdFrom(resumed)).toBe(sessionId);
    expect(resumed.headers['set-cookie']).toBeUndefined();
  });

  it('abre carta nova com cookie de outra carta e emite cookie novo', async () => {
    const firstToken = await createLetter(app);
    const firstClaim = await request(app).get(`/c/${firstToken}`);
    expect(firstClaim.status).toBe(302);
    const firstCookie = cookiePairFrom(firstClaim);
    const firstSessionId = sessionIdFrom(firstClaim);

    const creation = await request(app)
      .post('/api/letters')
      .send({ ...validDraft(), title: 'Carta B', message: 'Conteúdo exclusivo da carta B.' });
    expect(creation.status).toBe(201);
    const secondToken = (creation.body.url as string).slice('/c/'.length);

    const secondClaim = await request(app)
      .get(`/c/${secondToken}`)
      .set('Cookie', firstCookie);

    expect(secondClaim.status).toBe(302);
    expect(secondClaim.headers['set-cookie']).toBeDefined();

    const secondCookie = cookiePairFrom(secondClaim);
    const secondSessionId = sessionIdFrom(secondClaim);
    expect(secondSessionId).not.toBe(firstSessionId);
    expect(rawTokenFrom(secondCookie)).not.toBe(rawTokenFrom(firstCookie));

    const state = await request(app)
      .get(`/api/read/${secondSessionId}/state`)
      .set('Cookie', secondCookie);
    expect(state.status).toBe(200);

    const opened = await request(app)
      .post(`/api/read/${secondSessionId}/open`)
      .set('Cookie', secondCookie);
    expect(opened.status).toBe(200);
    expect(opened.body.title).toBe('Carta B');
    expect(opened.body.message).toBe('Conteúdo exclusivo da carta B.');
  });

  it('cookie de carta concluída não bloqueia a abertura de carta nova', async () => {
    const firstToken = await createLetter(app);
    const firstClaim = await request(app).get(`/c/${firstToken}`);
    const firstCookie = cookiePairFrom(firstClaim);
    const firstSessionId = sessionIdFrom(firstClaim);

    await request(app).post(`/api/read/${firstSessionId}/open`).set('Cookie', firstCookie);
    const completed = await request(app)
      .post(`/api/read/${firstSessionId}/complete`)
      .set('Cookie', firstCookie)
      .set('Idempotency-Key', `${firstSessionId}:complete`);
    expect(completed.status).toBe(200);

    const secondToken = await createLetter(app);
    const secondClaim = await request(app)
      .get(`/c/${secondToken}`)
      .set('Cookie', firstCookie);

    expect(secondClaim.status).toBe(302);
    expect(secondClaim.headers['set-cookie']).toBeDefined();

    const secondCookie = cookiePairFrom(secondClaim);
    const secondSessionId = sessionIdFrom(secondClaim);
    expect(secondSessionId).not.toBe(firstSessionId);

    const opened = await request(app)
      .post(`/api/read/${secondSessionId}/open`)
      .set('Cookie', secondCookie);
    expect(opened.status).toBe(200);
    expect(opened.body.message).toBe(validDraft().message);
  });

  it('mantém 410 no link da carta concluída mesmo quando seu cookie é apresentado', async () => {
    const token = await createLetter(app);
    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);

    await request(app).post(`/api/read/${sessionId}/open`).set('Cookie', cookie);
    const completed = await request(app)
      .post(`/api/read/${sessionId}/complete`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `${sessionId}:complete`);
    expect(completed.status).toBe(200);

    const replay = await request(app).get(`/c/${token}`).set('Cookie', cookie);
    expect(replay.status).toBe(410);
    expect(replay.body).toEqual({ error: 'Esta carta não está mais disponível.' });
    expect(replay.headers['set-cookie']).toBeUndefined();
  });

  it('cookie antigo não autoriza /open da sessão da carta nova', async () => {
    const firstToken = await createLetter(app);
    const firstClaim = await request(app).get(`/c/${firstToken}`);
    const firstCookie = cookiePairFrom(firstClaim);

    const secondToken = await createLetter(app);
    const secondClaim = await request(app)
      .get(`/c/${secondToken}`)
      .set('Cookie', firstCookie);
    expect(secondClaim.status).toBe(302);

    const forbidden = await request(app)
      .post(`/api/read/${sessionIdFrom(secondClaim)}/open`)
      .set('Cookie', firstCookie);
    expect(forbidden.status).toBe(403);
    expect(JSON.stringify(forbidden.body)).not.toContain(validDraft().message);
  });

  it('cookie órfão não bloqueia o claim de carta nova', async () => {
    const token = await createLetter(app);
    const orphanCookie = `entrelinhas_read=${generateToken()}`;

    const claim = await request(app).get(`/c/${token}`).set('Cookie', orphanCookie);

    expect(claim.status).toBe(302);
    expect(claim.headers['set-cookie']).toBeDefined();
    expect(rawTokenFrom(cookiePairFrom(claim))).not.toBe(rawTokenFrom(orphanCookie));
  });

  it('retoma sem cookie dentro da carência, preserva progresso e invalida o link', async () => {
    const token = await createLetter(app);
    const first = await request(app).get(`/c/${token}`);
    const firstCookie = cookiePairFrom(first);
    const firstSessionId = sessionIdFrom(first);

    await request(app).post(`/api/read/${firstSessionId}/open`).set('Cookie', firstCookie);
    await request(app)
      .post(`/api/read/${firstSessionId}/progress`)
      .set('Cookie', firstCookie)
      .send({ progress: 0.5 });

    const resumed = await request(app).get(`/c/${token}`);
    expect(resumed.status).toBe(302);

    const secondSessionId = sessionIdFrom(resumed);
    const secondCookie = cookiePairFrom(resumed);
    expect(secondSessionId).not.toBe(firstSessionId);

    const oldSession = one<{ state: string }>(
      'SELECT state FROM sessions WHERE id = ?',
      firstSessionId,
    );
    const newSession = one<{ state: string; epoch: number; last_progress: number }>(
      'SELECT state, epoch, last_progress FROM sessions WHERE id = ?',
      secondSessionId,
    );
    expect(oldSession?.state).toBe('invalidated');
    expect(newSession?.state).toBe('opening');
    // /open já incrementou a geração de 0 para 1; a retomada vai para 2.
    expect(newSession?.epoch).toBe(2);
    expect(newSession?.last_progress).toBeCloseTo(0.5);

    const link = one<{ token_hash: string }>('SELECT token_hash FROM letters');
    expect(link?.token_hash).not.toBe(hashToken(token, SECRET));

    const replay = await request(app).get(`/c/${token}`);
    expect(replay.status).toBe(410);

    const oldCookieOpen = await request(app)
      .post(`/api/read/${firstSessionId}/open`)
      .set('Cookie', firstCookie);
    // O cookie ainda pertence à sessão antiga, mas ela está invalidada (terminal).
    expect(oldCookieOpen.status).toBe(410);

    const newCookieOpen = await request(app)
      .post(`/api/read/${secondSessionId}/open`)
      .set('Cookie', secondCookie);
    expect(newCookieOpen.status).toBe(200);
  });

  it('devolve 410 para link expirado sem conteúdo', async () => {
    const token = await createLetter(app);
    const letter = one<{ id: string }>('SELECT id FROM letters');
    db.prepare('UPDATE letters SET expires_at = ? WHERE id = ?')
      .run(Date.now() - 1, letter?.id ?? '');

    const response = await request(app).get(`/c/${token}`);

    expect(response.status).toBe(410);
    expect(response.body).toEqual({ error: 'Esta carta não está mais disponível.' });
    expect(JSON.stringify(response.body)).not.toContain(validDraft().message);
  });

  it('produz exatamente uma sessão ativa em claims concorrentes', async () => {
    const token = await createLetter(app);

    const [first, second] = await Promise.all([
      request(app).get(`/c/${token}`),
      request(app).get(`/c/${token}`),
    ]);

    expect(first.status).toBe(302);
    expect(second.status).toBe(302);

    const sessions = db.prepare(
      'SELECT id, state, epoch FROM sessions',
    ).all() as Array<{ id: string; state: string; epoch: number }>;
    const active = sessions.filter(
      (session) => session.state === 'opening' || session.state === 'reading',
    );

    expect(active).toHaveLength(1);
    expect(sessions.filter((session) => session.state === 'invalidated')).toHaveLength(1);
    expect(Math.max(...sessions.map((session) => session.epoch))).toBe(1);
  });
});

describe('expiração', () => {
  it('expira carta não aberta e apaga o plaintext', async () => {
    await createLetter(app);
    db.prepare('UPDATE letters SET expires_at = ?').run(Date.now() - 1);

    const result = expireStale(db, config);

    const row = one<{ state: string; title: string; message: string }>(
      'SELECT state, title, message FROM letters',
    );
    expect(result.lettersExpired).toBe(1);
    expect(row?.state).toBe('expired');
    expect(row?.title).toBe('');
    expect(row?.message).toBe('');
  });

  it('expira sessão inativa e a carta sem sessão ativa', async () => {
    const token = await createLetter(app);
    const claim = await request(app).get(`/c/${token}`);
    const sessionId = sessionIdFrom(claim);
    const past = Date.now() - 1_000_000;

    db.prepare('UPDATE sessions SET last_seen_at = ?, grace_until = ? WHERE id = ?')
      .run(past, past, sessionId);

    const result = expireStale(db, config);

    const session = one<{ state: string }>(
      'SELECT state FROM sessions WHERE id = ?',
      sessionId,
    );
    const letter = one<{ state: string; message: string }>(
      'SELECT state, message FROM letters',
    );
    expect(result.sessionsExpired).toBe(1);
    expect(session?.state).toBe('expired');
    expect(letter?.state).toBe('expired');
    expect(letter?.message).toBe('');
  });

  it('nunca sobrescreve cartas concluídas', async () => {
    const token = await createLetter(app);
    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);

    await request(app).post(`/api/read/${sessionId}/open`).set('Cookie', cookie);
    await request(app).post(`/api/read/${sessionId}/complete`).set('Cookie', cookie);

    const past = Date.now() - 1_000_000;
    db.prepare('UPDATE sessions SET last_seen_at = ?, grace_until = ? WHERE id = ?')
      .run(past, past, sessionId);
    db.prepare('UPDATE letters SET expires_at = ?').run(past);

    expireStale(db, config);

    const row = one<{ state: string; title: string }>(
      'SELECT state, title FROM letters',
    );
    expect(row?.state).toBe('completed');
    expect(row?.title).toBe('');
  });
});

describe('cabeçalhos de segurança', () => {
  it('aplica CSP restritiva, referrer policy e CORS de recurso', async () => {
    const response = await request(app).get('/api/health');
    const csp = response.headers['content-security-policy'];

    expect(typeof csp).toBe('string');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  it('desliga cache nas rotas de leitura e assets', async () => {
    const state = await request(app).get('/api/read/qualquer/state');
    expect(state.headers['cache-control']).toBe('no-store, private');

    const asset = await request(app).get('/api/assets/qualquer');
    expect(asset.headers['cache-control']).toBe('no-store, private');
  });
});

describe('opções de leitura', () => {
  it('aceita fadeEnabled:false e devolve os prazos calculados pelo servidor', async () => {
    const creation = await request(app)
      .post('/api/letters')
      .send({ ...validDraft(), fadeEnabled: false });
    expect(creation.status).toBe(201);

    const token = (creation.body.url as string).slice('/c/'.length);
    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);

    const state = await request(app)
      .get(`/api/read/${sessionId}/state`)
      .set('Cookie', cookie);
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      fadeEnabled: false,
      sealAssetId: null,
      readDeadlineAt: expect.any(Number),
      idleDeadlineAt: expect.any(Number),
    });

    const session = one<{ created_at: number }>(
      'SELECT created_at FROM sessions WHERE id = ?',
      sessionId,
    );
    const createdAt = session?.created_at ?? 0;
    expect(state.body.readDeadlineAt - createdAt).toBe(600_000);
    expect(state.body.idleDeadlineAt - createdAt).toBeGreaterThanOrEqual(599_000);

    const opened = await request(app)
      .post(`/api/read/${sessionId}/open`)
      .set('Cookie', cookie);
    expect(opened.body.fadeEnabled).toBe(false);
    expect(opened.body.readDeadlineAt).toBe(state.body.readDeadlineAt);

    const row = one<{ fade_enabled: number; read_time_limit_seconds: number }>(
      'SELECT fade_enabled, read_time_limit_seconds FROM letters',
    );
    expect(row?.fade_enabled).toBe(0);
    expect(row?.read_time_limit_seconds).toBe(600);
  });

  it('usa o padrão do servidor quando a carta legada não tem limite salvo', async () => {
    const token = await createLetter(app);
    db.prepare('UPDATE letters SET read_time_limit_seconds = NULL').run();

    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);
    const state = await request(app)
      .get(`/api/read/${sessionId}/state`)
      .set('Cookie', cookie);
    const session = one<{ created_at: number }>(
      'SELECT created_at FROM sessions WHERE id = ?',
      sessionId,
    );

    expect(state.body.readDeadlineAt - (session?.created_at ?? 0)).toBe(600_000);
  });

  it('usa o prazo escolhido por quem envia e rejeita opções do leitor', async () => {
    const creation = await request(app)
      .post('/api/letters')
      .send({ ...validDraft(), readTimeLimitSeconds: 60 });
    expect(creation.status).toBe(201);

    const token = (creation.body.url as string).slice('/c/'.length);
    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);

    const state = await request(app)
      .get(`/api/read/${sessionId}/state`)
      .set('Cookie', cookie);
    const session = one<{ created_at: number }>(
      'SELECT created_at FROM sessions WHERE id = ?',
      sessionId,
    );
    expect(state.body.readDeadlineAt - (session?.created_at ?? 0)).toBe(60_000);

    const options = { fadeEnabled: false, readTimeLimitSeconds: 3600 };
    expect(
      (await request(app)
        .post(`/api/read/${sessionId}/progress`)
        .set('Cookie', cookie)
        .send({ progress: 0.1, ...options })).status,
    ).toBe(400);
    expect(
      (await request(app).post(`/api/read/${sessionId}/open`).set('Cookie', cookie).send(options))
        .status,
    ).toBe(400);
    expect(
      (await request(app)
        .post(`/api/read/${sessionId}/heartbeat`)
        .set('Cookie', cookie)
        .send(options)).status,
    ).toBe(400);
    expect(
      (await request(app)
        .post(`/api/read/${sessionId}/complete`)
        .set('Cookie', cookie)
        .send(options)).status,
    ).toBe(400);
  });
});

describe('prazo de leitura e inatividade', () => {
  it('dá 410 em /open, /progress e /complete após o prazo e limpa plaintext e assets', async () => {
    const asset = await upload(app, 'photo', pngBytes());
    const creation = await request(app)
      .post('/api/letters')
      .send({ ...letterWithPhoto(asset), readTimeLimitSeconds: 60 });
    expect(creation.status).toBe(201);

    const token = (creation.body.url as string).slice('/c/'.length);
    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);

    const session = one<{ created_at: number }>(
      'SELECT created_at FROM sessions WHERE id = ?',
      sessionId,
    );
    db.prepare('UPDATE sessions SET created_at = ? WHERE id = ?')
      .run((session?.created_at ?? 0) - 61_000, sessionId);

    const state = await request(app)
      .get(`/api/read/${sessionId}/state`)
      .set('Cookie', cookie);
    expect(state.status).toBe(200);
    expect(state.body.state).toBe('expired');

    expect(
      (await request(app).post(`/api/read/${sessionId}/open`).set('Cookie', cookie)).status,
    ).toBe(410);
    expect(
      (await request(app)
        .post(`/api/read/${sessionId}/progress`)
        .set('Cookie', cookie)
        .send({ progress: 0.5 })).status,
    ).toBe(410);
    expect(
      (await request(app).post(`/api/read/${sessionId}/complete`).set('Cookie', cookie)).status,
    ).toBe(410);

    const row = one<{ state: string; message: string; title: string }>(
      'SELECT state, message, title FROM letters',
    );
    expect(row?.state).toBe('expired');
    expect(row?.message).toBe('');
    expect(row?.title).toBe('');
    expect(JSON.stringify(row)).not.toContain(validDraft().message);
    expect(db.prepare('SELECT id FROM letter_assets').all()).toHaveLength(0);
  });

  it('expires after 10 minutes of idle even when grace_until is still in the future', async () => {
    const token = await createLetter(app);
    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);
    const now = Date.now();

    db.prepare('UPDATE sessions SET last_seen_at = ?, grace_until = ? WHERE id = ?')
      .run(now - 601_000, now + 600_000, sessionId);

    const state = await request(app)
      .get(`/api/read/${sessionId}/state`)
      .set('Cookie', cookie);
    expect(state.status).toBe(200);
    expect(state.body.state).toBe('expired');

    const session = one<{ state: string }>(
      'SELECT state FROM sessions WHERE id = ?',
      sessionId,
    );
    expect(session?.state).toBe('expired');

    const revoked = await request(app).get(`/c/${token}`).set('Cookie', cookie);
    expect(revoked.status).toBe(410);

    const letter = one<{ state: string; message: string }>(
      'SELECT state, message FROM letters',
    );
    expect(letter?.state).toBe('expired');
    expect(letter?.message).toBe('');
  });

  it('heartbeat renova apenas a inatividade e falha com 410 após o prazo', async () => {
    const token = await createLetter(app);
    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);

    const before = await request(app)
      .get(`/api/read/${sessionId}/state`)
      .set('Cookie', cookie);
    db.prepare('UPDATE sessions SET last_seen_at = last_seen_at - 120000 WHERE id = ?')
      .run(sessionId);

    const beat = await request(app)
      .post(`/api/read/${sessionId}/heartbeat`)
      .set('Cookie', cookie);
    expect(beat.status).toBe(200);
    expect(beat.body.state).toBe('opening');
    expect(beat.body.readDeadlineAt).toBe(before.body.readDeadlineAt);
    expect(beat.body.idleDeadlineAt).toBeGreaterThanOrEqual(before.body.idleDeadlineAt);
    expect(beat.body.progress).toBe(0);

    const session = one<{ last_seen_at: number; created_at: number }>(
      'SELECT last_seen_at, created_at FROM sessions WHERE id = ?',
      sessionId,
    );
    expect(session?.last_seen_at).toBeGreaterThan(before.body.idleDeadlineAt - 600_000 - 5_000);
    expect(session?.created_at).toBeLessThanOrEqual(session?.last_seen_at ?? 0);

    db.prepare('UPDATE sessions SET created_at = ? WHERE id = ?')
      .run((session?.created_at ?? 0) - 601_000, sessionId);
    const expired = await request(app)
      .post(`/api/read/${sessionId}/heartbeat`)
      .set('Cookie', cookie);
    expect(expired.status).toBe(410);
  });
});

describe('assets binários', () => {
  it('valida magic bytes, tipo declarado e tetos de tamanho', async () => {
    const wrongMagic = await request(app)
      .post('/api/assets')
      .set('Content-Type', 'image/png')
      .set('x-asset-kind', 'photo')
      .send(Buffer.alloc(30));
    expect(wrongMagic.status).toBe(400);

    const mismatch = await request(app)
      .post('/api/assets')
      .set('Content-Type', 'image/jpeg')
      .set('x-asset-kind', 'photo')
      .send(pngBytes());
    expect(mismatch.status).toBe(400);

    const jpegSeal = await request(app)
      .post('/api/assets')
      .set('Content-Type', 'image/jpeg')
      .set('x-asset-kind', 'seal')
      .send(jpegBytes());
    expect(jpegSeal.status).toBe(400);

    const oneMiBPhoto = await request(app)
      .post('/api/assets')
      .set('Content-Type', 'image/png')
      .set('x-asset-kind', 'photo')
      .send(pngOfSize(1024 * 1024));
    expect(oneMiBPhoto.status).toBe(201);

    // Confirma que express.raw({ limit: '2mb' }) não trunca 2.097.152 bytes.
    const exactLimitPhoto = await request(app)
      .post('/api/assets')
      .set('Content-Type', 'image/png')
      .set('x-asset-kind', 'photo')
      .send(pngOfSize(2 * 1024 * 1024));
    expect(exactLimitPhoto.status).toBe(201);

    const bigPhoto = await request(app)
      .post('/api/assets')
      .set('Content-Type', 'image/png')
      .set('x-asset-kind', 'photo')
      .send(pngOfSize(2 * 1024 * 1024 + 1));
    expect(bigPhoto.status).toBe(413);

    const bigSeal = await request(app)
      .post('/api/assets')
      .set('Content-Type', 'image/png')
      .set('x-asset-kind', 'seal')
      .send(Buffer.concat([pngBytes(), Buffer.alloc(16_384)]));
    expect(bigSeal.status).toBe(413);

    const valid = await upload(app, 'seal', webpBytes(), 'image/webp');
    expect(valid.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Buffer.from(valid.uploadToken, 'base64url')).toHaveLength(32);
  });

  it('rejeita ids duplicados, token inválido e reutilização de asset', async () => {
    const asset = await upload(app, 'photo', pngBytes());
    const duplicate = {
      ...validDraft(),
      assets: [asset, asset],
      message: `[[foto:${asset.id}]]`,
    };
    expect((await request(app).post('/api/letters').send(duplicate)).status).toBe(400);

    const badToken = {
      ...letterWithPhoto(asset),
      assets: [{ id: asset.id, uploadToken: 'x'.repeat(43) }],
    };
    expect((await request(app).post('/api/letters').send(badToken)).status).toBe(400);

    const created = await request(app).post('/api/letters').send(letterWithPhoto(asset));
    expect(created.status).toBe(201);
    const reused = await request(app).post('/api/letters').send(letterWithPhoto(asset));
    expect(reused.status).toBe(400);
  });

  it('vincula selo customizado e devolve sealAssetId no /open', async () => {
    const photo = await upload(app, 'photo', pngBytes());
    const seal = await upload(app, 'seal', pngBytes(), 'image/png');
    const draft = {
      ...letterWithPhoto(photo),
      assets: [photo, seal],
      sealAssetId: seal.id,
    };

    const creation = await request(app).post('/api/letters').send(draft);
    expect(creation.status).toBe(201);
    const token = (creation.body.url as string).slice('/c/'.length);
    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);

    const opened = await request(app)
      .post(`/api/read/${sessionId}/open`)
      .set('Cookie', cookie);
    expect(opened.body.theme.seal).toBe('custom');
    expect(opened.body.sealAssetId).toBe(seal.id);
  });

  it('serve o BLOB só para a sessão dona e apaga assets ao concluir', async () => {
    const asset = await upload(app, 'photo', pngBytes());
    const creation = await request(app).post('/api/letters').send(letterWithPhoto(asset));
    expect(creation.status).toBe(201);
    const token = (creation.body.url as string).slice('/c/'.length);
    const claim = await request(app).get(`/c/${token}`);
    const cookie = cookiePairFrom(claim);
    const sessionId = sessionIdFrom(claim);

    const anonymous = await request(app).get(`/api/assets/${asset.id}`);
    expect(anonymous.status).toBe(404);

    const otherToken = await createLetter(app);
    const otherClaim = await request(app).get(`/c/${otherToken}`);
    const otherCookie = cookiePairFrom(otherClaim);
    const wrongSession = await request(app)
      .get(`/api/assets/${asset.id}`)
      .set('Cookie', otherCookie);
    expect(wrongSession.status).toBe(404);

    const served = await request(app)
      .get(`/api/assets/${asset.id}`)
      .set('Cookie', cookie)
      .buffer(true);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['cache-control']).toBe('no-store, private');

    await request(app).post(`/api/read/${sessionId}/open`).set('Cookie', cookie);
    const completed = await request(app)
      .post(`/api/read/${sessionId}/complete`)
      .set('Cookie', cookie);
    expect(completed.status).toBe(200);

    const assets = db.prepare('SELECT id FROM letter_assets').all() as unknown[];
    expect(assets).toHaveLength(0);
    const gone = await request(app)
      .get(`/api/assets/${asset.id}`)
      .set('Cookie', cookie);
    expect(gone.status).toBe(404);
  });

  it('limpa assets de carta não aberta expirada pelo job', async () => {
    const asset = await upload(app, 'photo', pngBytes());
    const creation = await request(app).post('/api/letters').send(letterWithPhoto(asset));
    expect(creation.status).toBe(201);
    db.prepare('UPDATE letters SET expires_at = ?').run(Date.now() - 1);

    const result = expireStale(db, config);
    expect(result.lettersExpired).toBe(1);
    expect(db.prepare('SELECT id FROM letter_assets').all()).toHaveLength(0);
  });

  it('expireStale descarta assets órfãos com mais de uma hora', async () => {
    await upload(app, 'photo', pngBytes());
    db.prepare('UPDATE letter_assets SET created_at = ?').run(Date.now() - 3_600_001);

    const result = expireStale(db, config);
    expect(result.assetsDeleted).toBe(1);
    expect(db.prepare('SELECT id FROM letter_assets').all()).toHaveLength(0);
  });
});
