import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@ais/shared';
import { forbidden } from '../lib/errors.js';

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden('Coordinator access required');
    next();
  };
}
