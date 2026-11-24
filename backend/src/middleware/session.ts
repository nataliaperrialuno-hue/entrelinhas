import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../config';

const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const readerTokens = new WeakMap<Request, string | null>();

export function readerCookieName(config: AppConfig): string {
  return config.nodeEnv === 'production'
    ? '__Host-entrelinhas_read'
    : 'entrelinhas_read';
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();

  if (header === undefined) {
    return cookies;
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === '' || cookies.has(name)) {
      continue;
    }

    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }

  return cookies;
}

export function sessionCookieMiddleware(config: AppConfig) {
  const name = readerCookieName(config);

  return (req: Request, _res: Response, next: NextFunction): void => {
    readerTokens.set(req, parseCookies(req.headers.cookie).get(name) ?? null);
    next();
  };
}

export function readerToken(req: Request): string | null {
  return readerTokens.get(req) ?? null;
}

export function setReaderCookie(res: Response, config: AppConfig, token: string): void {
  res.cookie(readerCookieName(config), token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS,
  });
}
