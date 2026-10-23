import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { env } from '../env.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { MOCK_PERSONAS, type MockPersonaKey } from '@ais/shared';

// A test/demo seam, never an identity provider. No role header is trusted outside mock mode.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!env.LOCAL_MOCK_MODE || env.NODE_ENV === 'production') {
    res.status(503).json({ error: 'Real authentication is not configured. Use the isolated local mock launcher for review.' });
    return;
  }
  const key = req.header('x-mock-persona') ?? 'coordinator';
  if (!Object.hasOwn(MOCK_PERSONAS, key)) throw unauthorized('Unknown local mock persona');
  const persona = MOCK_PERSONAS[key as MockPersonaKey];
  const user = db.select().from(users).where(eq(users.email, persona.email)).get();
  if (!user || !user.isActive) throw unauthorized('Start the synthetic review fixture to use local personas');
  req.user = { id: user.id, email: user.email, role: persona.role };
  next();
}

// Keep legacy endpoints private by default. Public contracts are deliberately narrow.
export function mockRoleBoundary(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role === 'admin') return next();
  const path = req.path.replace(/\/$/, '') || '/';
  const allowed = req.method === 'GET' && (/^\/games(?:\/\d+)?$/.test(path) || /^\/requests(?:\/\d+)?$/.test(path) || ['/session', '/request-options'].includes(path))
    || req.method === 'POST' && path === '/requests';
  if (!allowed) throw forbidden('Coordinator tools are unavailable in the requester view');
  next();
}
