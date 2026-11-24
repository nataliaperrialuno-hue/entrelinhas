import type { NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { AppConfig } from '../config';

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
});

export function noStoreForReading(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith('/api/read/') || req.path.startsWith('/leitura/')) {
    res.setHeader('Cache-Control', 'no-store, private');
  }

  next();
}

export function createRateLimiter(config: AppConfig) {
  return rateLimit({
    limit: config.rateLimitMax,
    windowMs: config.rateLimitWindowMs,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Tente novamente em instantes.' },
  });
}
