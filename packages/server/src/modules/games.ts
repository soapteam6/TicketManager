import { Router, type Request, type Response } from 'express';
import { and, asc, eq, getTableColumns, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createGameSchema, updateGameSchema, idParam } from '@ais/shared';
import { db } from '../db/client.js';
import { games, seasons, teams } from '../db/schema.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { badRequest, notFound } from '../lib/errors.js';

// Convert an incoming date string (YYYY-MM-DD or ISO) to unix-ms; guard invalid dates.
function toMs(value: string, field: string): number {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) throw badRequest(`Invalid date for ${field}`);
  return ms;
}

const gamesListQuery = z.object({
  seasonId: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  status: z.string().min(1).optional(),
  seasonStatus: z.string().min(1).optional(),
});

export const gamesRouter = Router();
gamesRouter.use(requireAuth);

gamesRouter.get('/', validate(gamesListQuery, 'query'), (req: Request, res: Response) => {
  const { seasonId, teamId, status, seasonStatus } = req.query as unknown as { seasonId?: number; teamId?: number; status?: string; seasonStatus?: string };
  const conditions = [];
  if (seasonId) conditions.push(eq(games.seasonId, seasonId));
  if (teamId) conditions.push(eq(seasons.teamId, teamId));
  if (status) conditions.push(eq(games.status, status));
  if (seasonStatus) conditions.push(eq(seasons.status, seasonStatus));
  const where = conditions.length === 1 ? conditions[0] : conditions.length > 1 ? and(...conditions) : undefined;
  // Enrich with team info so the request form can cascade Team -> Opponent -> start time.
  const base = db
    .select({
      ...getTableColumns(games),
      teamId: teams.id,
      teamName: teams.name,
      seasonLabel: seasons.label,
      seasonStatus: seasons.status,
      availableSeats: sql<number>`(SELECT count(*) FROM seats WHERE seats.game_id = ${games.id} AND seats.status = 'available')`,
    })
    .from(games)
    .innerJoin(seasons, eq(games.seasonId, seasons.id))
    .innerJoin(teams, eq(seasons.teamId, teams.id));
  const rows = (where ? base.where(where) : base).orderBy(asc(games.gameDate)).all();
  res.json({ games: rows });
});

gamesRouter.get('/:id', validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const game = db.select().from(games).where(eq(games.id, id)).get();
  if (!game) throw notFound('Game not found');
  const season = db.select().from(seasons).where(eq(seasons.id, game.seasonId)).get();
  const team = season ? db.select().from(teams).where(eq(teams.id, season.teamId)).get() : undefined;
  res.json({ game: { ...game, seasonLabel: season?.label ?? null, teamName: team?.name ?? null } });
});

gamesRouter.post('/', requireRole('admin'), validate(createGameSchema), (req: Request, res: Response) => {
  const input = req.body as z.infer<typeof createGameSchema>;
  const season = db.select().from(seasons).where(eq(seasons.id, input.seasonId)).get();
  if (!season) throw notFound('Season not found');
  const game = db
    .insert(games)
    .values({
      seasonId: input.seasonId,
      gameDate: toMs(input.gameDate, 'gameDate'),
      opponent: input.opponent,
      promotions: input.promotions ?? null,
      notes: input.notes ?? null,
      premiumScore: input.premiumScore ?? 0.5,
      createdAt: Date.now(),
    })
    .returning()
    .get();
  res.status(201).json({ game });
});

gamesRouter.patch('/:id', requireRole('admin'), validate(idParam, 'params'), validate(updateGameSchema), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const existing = db.select().from(games).where(eq(games.id, id)).get();
  if (!existing) throw notFound('Game not found');
  const input = req.body as z.infer<typeof updateGameSchema>;
  const game = db
    .update(games)
    .set({
      gameDate: input.gameDate === undefined ? existing.gameDate : toMs(input.gameDate, 'gameDate'),
      opponent: input.opponent ?? existing.opponent,
      promotions: input.promotions === undefined ? existing.promotions : input.promotions,
      notes: input.notes === undefined ? existing.notes : input.notes,
      premiumScore: input.premiumScore ?? existing.premiumScore,
      status: input.status ?? existing.status,
    })
    .where(eq(games.id, id))
    .returning()
    .get();
  res.json({ game });
});

gamesRouter.post('/:id/cancel', requireRole('admin'), validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const existing = db.select().from(games).where(eq(games.id, id)).get();
  if (!existing) throw notFound('Game not found');
  const game = db.update(games).set({ status: 'cancelled' }).where(eq(games.id, id)).returning().get();
  res.json({ game });
});
