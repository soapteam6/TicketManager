import { Router, type Request, type Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { integrationLogs } from '../db/schema.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth, requireRole('admin'));

const logsQuery = z.object({
  adapter: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

integrationsRouter.get('/logs', validate(logsQuery, 'query'), (req: Request, res: Response) => {
  const { adapter, status, limit } = req.query as unknown as { adapter?: string; status?: string; limit?: number };
  const filters = [];
  if (adapter) filters.push(eq(integrationLogs.adapter, adapter));
  if (status) filters.push(eq(integrationLogs.status, status));
  const where = filters.length ? and(...filters) : undefined;
  const logs = db
    .select()
    .from(integrationLogs)
    .where(where)
    .orderBy(desc(integrationLogs.createdAt))
    .limit(limit ?? 100)
    .all();
  res.json({ logs });
});
