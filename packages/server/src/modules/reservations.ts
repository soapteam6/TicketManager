import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { idParam } from '@ais/shared';
import { db } from '../db/client.js';
import { games } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { badRequest, notFound } from '../lib/errors.js';
import { createReservations, listReservations, claimReservation, releaseReservation } from './reservations-service.js';

// Convert an incoming expiry (YYYY-MM-DD or ISO datetime) to unix-ms. Date-only = end of that day.
function toExpiryMs(value: string): number {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const ms = new Date(dateOnly ? `${value}T23:59:59` : value).getTime();
  if (Number.isNaN(ms)) throw badRequest('Invalid expiry date');
  return ms;
}

const createSchema = z.object({
  personName: z.string().min(1),
  personEmail: z.string().email().optional().or(z.literal('')),
  quantity: z.coerce.number().int().min(1).max(50),
  ticketType: z.string().min(1).optional(),
  expiresAt: z.string().min(1),
});

// --- Game-scoped: /games/:gameId/reservations ---
export const gameReservationsRouter = Router({ mergeParams: true });
gameReservationsRouter.use(requireAuth);

function requireGame(req: Request): number {
  const gameId = Number((req.params as Record<string, string>).gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) throw badRequest('Invalid game id');
  if (!db.select().from(games).where(eq(games.id, gameId)).get()) throw notFound('Game not found');
  return gameId;
}

gameReservationsRouter.get('/', (req: Request, res: Response) => {
  const gameId = requireGame(req);
  res.json({ reservations: listReservations(gameId) });
});

gameReservationsRouter.post('/', requireRole('admin'), validate(createSchema), (req: Request, res: Response) => {
  const gameId = requireGame(req);
  const input = req.body as z.infer<typeof createSchema>;
  const created = createReservations({
    gameId,
    personName: input.personName,
    personEmail: input.personEmail || undefined,
    ticketType: input.ticketType,
    quantity: input.quantity,
    expiresAt: toExpiryMs(input.expiresAt),
    userId: req.user!.id,
  });
  res.status(201).json({ created: created.length, reservations: created });
});

// --- Flat: /reservations/:id/(claim|release) ---
export const reservationsRouter = Router();
reservationsRouter.use(requireAuth);

reservationsRouter.post('/:id/claim', requireRole('admin'), validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  res.json({ reservation: claimReservation(id) });
});

reservationsRouter.post('/:id/release', requireRole('admin'), validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  releaseReservation(id);
  res.json({ ok: true });
});
