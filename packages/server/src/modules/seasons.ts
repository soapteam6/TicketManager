import { Router, type Request, type Response } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createSeasonSchema, updateSeasonSchema, importGamesSchema, idParam } from '@ais/shared';
import { db } from '../db/client.js';
import { seasons, games, teams } from '../db/schema.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { badRequest, conflict, notFound, isUniqueViolation } from '../lib/errors.js';

// Convert an incoming date string (YYYY-MM-DD or ISO) to unix-ms; guard invalid dates.
function toMs(value: string, field: string): number {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) throw badRequest(`Invalid date for ${field}`);
  return ms;
}

const seasonsListQuery = z.object({ teamId: z.coerce.number().int().positive().optional() });

export const seasonsRouter = Router();
seasonsRouter.use(requireAuth);

seasonsRouter.get('/', validate(seasonsListQuery, 'query'), (req: Request, res: Response) => {
  const { teamId } = req.query as unknown as { teamId?: number };
  const rows = teamId
    ? db.select().from(seasons).where(eq(seasons.teamId, teamId)).all()
    : db.select().from(seasons).all();
  res.json({ seasons: rows });
});

seasonsRouter.get('/:id', validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const season = db.select().from(seasons).where(eq(seasons.id, id)).get();
  if (!season) throw notFound('Season not found');
  const seasonGames = db.select().from(games).where(eq(games.seasonId, id)).orderBy(asc(games.gameDate)).all();
  res.json({ season, games: seasonGames });
});

seasonsRouter.post('/', requireRole('admin'), validate(createSeasonSchema), (req: Request, res: Response) => {
  const input = req.body as z.infer<typeof createSeasonSchema>;
  const team = db.select().from(teams).where(eq(teams.id, input.teamId)).get();
  if (!team) throw notFound('Team not found');
  if (db.select().from(seasons).where(and(eq(seasons.teamId, input.teamId), eq(seasons.label, input.label))).get()) {
    throw conflict('Season label already exists for this team');
  }
  const season = db
    .insert(seasons)
    .values({
      teamId: input.teamId,
      label: input.label,
      startDate: toMs(input.startDate, 'startDate'),
      endDate: toMs(input.endDate, 'endDate'),
      status: input.status ?? 'draft',
      createdAt: Date.now(),
    })
    .returning()
    .get();
  res.status(201).json({ season });
});

seasonsRouter.patch('/:id', requireRole('admin'), validate(idParam, 'params'), validate(updateSeasonSchema), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const existing = db.select().from(seasons).where(eq(seasons.id, id)).get();
  if (!existing) throw notFound('Season not found');
  const input = req.body as z.infer<typeof updateSeasonSchema>;
  if (input.label && input.label !== existing.label && db.select().from(seasons).where(and(eq(seasons.teamId, existing.teamId), eq(seasons.label, input.label))).get()) {
    throw conflict('Season label already exists for this team');
  }
  const season = db
    .update(seasons)
    .set({
      label: input.label ?? existing.label,
      startDate: input.startDate === undefined ? existing.startDate : toMs(input.startDate, 'startDate'),
      endDate: input.endDate === undefined ? existing.endDate : toMs(input.endDate, 'endDate'),
      status: input.status ?? existing.status,
    })
    .where(eq(seasons.id, id))
    .returning()
    .get();
  res.json({ season });
});

seasonsRouter.post('/:id/activate', requireRole('admin'), validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const existing = db.select().from(seasons).where(eq(seasons.id, id)).get();
  if (!existing) throw notFound('Season not found');
  const season = db.update(seasons).set({ status: 'active' }).where(eq(seasons.id, id)).returning().get();
  res.json({ season });
});

seasonsRouter.post('/:id/games/import', requireRole('admin'), validate(idParam, 'params'), validate(importGamesSchema), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const season = db.select().from(seasons).where(eq(seasons.id, id)).get();
  if (!season) throw notFound('Season not found');
  const input = req.body as z.infer<typeof importGamesSchema>;
  let imported = 0;
  let skipped = 0;
  const now = Date.now();
  for (const g of input.games) {
    try {
      db.insert(games)
        .values({
          seasonId: id,
          gameDate: toMs(g.gameDate, 'gameDate'),
          opponent: g.opponent,
          promotions: g.promotions ?? null,
          premiumScore: g.premiumScore ?? 0.5,
          createdAt: now,
        })
        .run();
      imported += 1;
    } catch (err) {
      if (isUniqueViolation(err)) {
        skipped += 1;
      } else {
        throw err;
      }
    }
  }
  res.json({ imported, skipped });
});
