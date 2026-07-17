import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { seats } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { badRequest } from '../lib/errors.js';
import { addToWaitlist, listWaitlist } from './waitlist-service.js';
import { promoteWaitlist, seatLabel } from './assignments-service.js';

export const waitlistRouter = Router();
waitlistRouter.use(requireAuth);

waitlistRouter.get('/', (req: Request, res: Response) => {
  const gameId = Number(req.query.gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) throw badRequest('gameId query param required');
  const rows = listWaitlist(gameId);
  res.json({
    waitlist: rows.map(({ entry, req: r }) => ({
      ...entry,
      requesterName: r?.requesterName ?? null,
      quantity: r?.quantity ?? null,
      requestStatus: r?.status ?? null,
    })),
  });
});

const addSchema = z.object({ gameId: z.coerce.number().int().positive(), requestId: z.coerce.number().int().positive() });

waitlistRouter.post('/', requireRole('admin'), validate(addSchema), (req: Request, res: Response) => {
  addToWaitlist(req.body.gameId, req.body.requestId, 'Manually waitlisted');
  res.status(201).json({ ok: true });
});

waitlistRouter.post('/promote', requireRole('admin'), validate(z.object({ gameId: z.coerce.number().int().positive() })), (req: Request, res: Response) => {
  const promoted = promoteWaitlist(req.body.gameId);
  res.json({ promotedSeats: promoted });
});

// Convenience: available seats for a game (used by reassign/manual-assign UIs).
waitlistRouter.get('/available-seats', (req: Request, res: Response) => {
  const gameId = Number(req.query.gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) throw badRequest('gameId query param required');
  const rows = db.select().from(seats).where(and(eq(seats.gameId, gameId), eq(seats.status, 'available'))).all();
  res.json({ seats: rows.map((s) => ({ id: s.id, label: seatLabel(s), section: s.section, row: s.row, seatNumber: s.seatNumber })) });
});
