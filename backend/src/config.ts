export interface AppConfig {
  port: number;
  nodeEnv: string;
  tokenHmacSecret: string;
  letterTtlDays: number;
  sessionGraceMinutes: number;
  /** Inatividade máxima (medida por sessions.last_seen_at) antes de apagar a carta. */
  idleTimeoutSeconds: number;
  /** Prazo padrão quando a carta não escolheu um limite próprio. */
  defaultReadTimeLimitSeconds: number;
  heartbeatTtlSeconds: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  publicAppUrl: string;
}

const DEVELOPMENT_SECRET = 'dev-only-insecure-secret-change-me';

function positiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';

  let tokenHmacSecret = env.TOKEN_HMAC_SECRET;
  if (tokenHmacSecret === undefined || tokenHmacSecret === '') {
    if (nodeEnv === 'development') {
      tokenHmacSecret = DEVELOPMENT_SECRET;
    } else {
      throw new Error('TOKEN_HMAC_SECRET é obrigatório fora do ambiente de desenvolvimento');
    }
  }

  return {
    port: positiveNumber(env.PORT, 3001),
    nodeEnv,
    tokenHmacSecret,
    letterTtlDays: positiveNumber(env.LETTER_TTL_DAYS, 30),
    sessionGraceMinutes: positiveNumber(env.SESSION_GRACE_MINUTES, 10),
    idleTimeoutSeconds: positiveNumber(env.IDLE_TIMEOUT_SECONDS, 600),
    defaultReadTimeLimitSeconds: positiveNumber(env.DEFAULT_READ_TIME_LIMIT_SECONDS, 600),
    heartbeatTtlSeconds: positiveNumber(env.HEARTBEAT_TTL_SECONDS, 120),
    rateLimitMax: positiveNumber(env.RATE_LIMIT_MAX, 30),
    rateLimitWindowMs: positiveNumber(env.RATE_LIMIT_WINDOW_MS, 60000),
    publicAppUrl: env.PUBLIC_APP_URL ?? 'http://localhost:5173',
  };
}
