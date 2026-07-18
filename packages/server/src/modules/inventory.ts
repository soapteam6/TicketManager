import { Router, type Request, type Response } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { bulkSeatsSchema } from '@ais/shared';
import { db } from '../db/client.js';
import { seats, games } from '../db/schema.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { badRequest, notFound, isUniqueViolation } from '../lib/errors.js';
import { expireDueReservations } from './reservations-service.js';

// Mounted at /games/:gameId/seats.
export const inventoryRouter = Router({ mergeParams: true });
inventoryRouter.use(requireAuth);

// Read & validate :gameId from the merged params, and ensure the game exists.
function requireGame(req: Request): number {
  const gameId = Number(req.params.gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) throw badRequest('Invalid gameId');
  if (!db.select().from(games).where(eq(games.id, gameId)).get()) throw notFound('Game not found');
  return gameId;
}

const seatsListQuery = z.object({ status: z.string().min(1).optional() });

inventoryRouter.get('/', validate(seatsListQuery, 'query'), (req: Request, res: Response) => {
  const gameId = requireGame(req);
  // Release any expired holds first so the available/held counts are accurate.
  expireDueReservations(gameId);
  const { status } = req.query as unknown as { status?: string };
  const where = status ? and(eq(seats.gameId, gameId), eq(seats.status, status)) : eq(seats.gameId, gameId);
  const rows = db.select().from(seats).where(where).orderBy(asc(seats.section), asc(seats.row), asc(seats.seatNumber)).all();
  res.json({ seats: rows });
});

inventoryRouter.post('/', requireRole('admin'), validate(bulkSeatsSchema), (req: Request, res: Response) => {
  const gameId = requireGame(req);
  const input = req.body as z.infer<typeof bulkSeatsSchema>;
  const now = Date.now();

  // Seats are a generic pool ("General Admission"). Continue numbering from the highest
  // existing seat number so repeated "Add seats" calls never collide on the unique index.
  const existing = db.select().from(seats).where(eq(seats.gameId, gameId)).all();
  let next = existing.reduce((max, s) => Math.max(max, Number(s.seatNumber) || 0), 0) + 1;

  const ticketType = input.ticketType?.trim() || 'Standard';
  let created = 0;
  for (let i = 0; i < input.count; i += 1, next += 1) {
    try {
      db.insert(seats)
        .values({
          gameId,
          section: 'GA',
          row: 'GA',
          seatNumber: String(next),
          ticketType,
          isAda: 0,
          status: 'available',
          createdAt: now,
        })
        .run();
      created += 1;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  // Keep the game's cached seat count in sync with the actual inventory.
  const total = db.select().from(seats).where(eq(seats.gameId, gameId)).all().length;
  db.update(games).set({ totalSeats: total }).where(eq(games.id, gameId)).run();
  res.status(201).json({ created });
});
