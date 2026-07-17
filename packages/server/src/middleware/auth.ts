import type { Request, Response, NextFunction } from 'express';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import type { RequestUser } from '../types.js';

// Authentication has been intentionally removed: the app runs open, with everyone acting as an
// administrator. We still resolve a single system user so database attribution (assigned_by,
// recorded_by, etc.) and foreign keys stay valid.
let systemUser: RequestUser | null = null;

function resolveSystemUser(): RequestUser {
  if (systemUser) return systemUser;
  const admin =
    db.select().from(users).where(eq(users.role, 'admin')).orderBy(asc(users.id)).get() ??
    db.select().from(users).orderBy(asc(users.id)).get();
  systemUser = admin
    ? { id: admin.id, email: admin.email, role: 'admin' }
    : { id: 0, email: 'system@ais.local', role: 'admin' };
  return systemUser;
}

// Injects the system user on every request; never rejects.
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  req.user = resolveSystemUser();
  next();
}
