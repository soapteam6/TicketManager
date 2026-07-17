import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@ais/shared';

// Authorization has been intentionally removed — everyone is treated as an admin.
// Kept as a pass-through so existing route definitions need no changes.
export function requireRole(..._roles: Role[]) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}
