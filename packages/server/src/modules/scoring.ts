import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { createScoringConfigSchema, idParam, DEFAULT_SCORING_WEIGHTS, DEFAULT_SCORING_PARAMS } from '@ais/shared';
import { db } from '../db/client.js';
import { scoringConfigs } from '../db/schema.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { notFound, conflict } from '../lib/errors.js';
import { getActiveConfig } from './scoring-service.js';

export const scoringRouter = Router();
scoringRouter.use(requireAuth);

function deserialize(row: typeof scoringConfigs.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    isActive: !!row.isActive,
    version: row.version,
    weights: JSON.parse(row.weights),
    params: JSON.parse(row.params),
    createdAt: row.createdAt,
  };
}

scoringRouter.get('/configs', (_req: Request, res: Response) => {
  const rows = db.select().from(scoringConfigs).all();
  res.json({ configs: rows.map(deserialize) });
});

scoringRouter.get('/configs/active', (_req: Request, res: Response) => {
  const active = getActiveConfig();
  res.json({ config: active, defaults: { weights: DEFAULT_SCORING_WEIGHTS, params: DEFAULT_SCORING_PARAMS } });
});

scoringRouter.post('/configs', requireRole('admin'), validate(createScoringConfigSchema), (req: Request, res: Response) => {
  const input = req.body;
  const now = Date.now();
  const created = db.transaction(() => {
    if (input.activate) {
      db.update(scoringConfigs).set({ isActive: 0 }).where(eq(scoringConfigs.isActive, 1)).run();
    }
    return db
      .insert(scoringConfigs)
      .values({
        name: input.name,
        isActive: input.activate ? 1 : 0,
        version: 1,
        weights: JSON.stringify(input.weights),
        params: JSON.stringify(input.params),
        createdByUserId: req.user!.id,
        createdAt: now,
      })
      .returning()
      .get();
  });
  res.status(201).json({ config: deserialize(created) });
});

scoringRouter.delete('/configs/:id', requireRole('admin'), validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const existing = db.select().from(scoringConfigs).where(eq(scoringConfigs.id, id)).get();
  if (!existing) throw notFound('Config not found');
  if (existing.isActive) throw conflict('Cannot delete the active configuration. Activate another first.');
  db.delete(scoringConfigs).where(eq(scoringConfigs.id, id)).run();
  res.json({ ok: true });
});

scoringRouter.post('/configs/:id/activate', requireRole('admin'), validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const existing = db.select().from(scoringConfigs).where(eq(scoringConfigs.id, id)).get();
  if (!existing) throw notFound('Config not found');
  db.transaction(() => {
    db.update(scoringConfigs).set({ isActive: 0 }).where(eq(scoringConfigs.isActive, 1)).run();
    db.update(scoringConfigs).set({ isActive: 1 }).where(eq(scoringConfigs.id, id)).run();
  });
  res.json({ ok: true });
});
