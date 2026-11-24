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
    expect(state.body).toEqual({ state: 'opening', progress: 0 });
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

  it('desliga cache nas rotas de leitura', async () => {
    const state = await request(app).get('/api/read/qualquer/state');
    expect(state.headers['cache-control']).toBe('no-store, private');
  });
});
