import type { Request, Response, NextFunction } from 'express';
import { HttpError, isUniqueViolation } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details ?? undefined });
    return;
  }
  if (isUniqueViolation(err)) {
    res.status(409).json({ error: 'Resource already exists or conflicts with an existing record' });
    return;
  }
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Route not found' });
}
