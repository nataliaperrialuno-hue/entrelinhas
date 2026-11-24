import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export const UNAVAILABLE_MESSAGE = 'Esta carta não está mais disponível.';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function unavailableError(): HttpError {
  return new HttpError(410, UNAVAILABLE_MESSAGE);
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) {
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Dados inválidos.' });
    return;
  }

  //Detalhes internos nunca são enviados ao cliente.
  res.status(500).json({ error: 'Erro interno' });
}
