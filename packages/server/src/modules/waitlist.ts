import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { seats } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { idParam } from '@ais/shared';
import { badRequest } from '../lib/errors.js';
import { listWaitlist, moveRequestToWaitlist, restoreFromWaitlist } from './waitlist-service.js';
import { promoteWaitlist, seatLabel } from './assignments-service.js';

export const waitlistRouter = Router();
waitlistRouter.use(requireAuth);

waitlistRouter.get('/', (req: Request, res: Response) => {
  // gameId is optional — omit it to list the waitlist across all games.
  let gameId: number | undefined;
  if (req.query.gameId !== undefined && req.query.gameId !== '') {
    gameId = Number(req.query.gameId);
    if (!Number.isInteger(gameId) || gameId <= 0) throw badRequest('invalid gameId');
  }
  const rows = listWaitlist(gameId);
  res.json({
    waitlist: rows.map(({ entry, req: r, game }) => ({
      ...entry,
      requesterName: r?.requesterName ?? null,
      quantity: r?.quantity ?? null,
      requestStatus: r?.status ?? null,
      opponent: game?.opponent ?? null,
      gameTitle: game?.title ?? null,
      gameKind: game?.kind ?? null,
    })),
  });
});

const addSchema = z.object({ gameId: z.coerce.number().int().positive(), requestId: z.coerce.number().int().positive() });

// Move a request onto the waitlist (frees any seats it holds).
waitlistRouter.post('/', requireRole('admin'), validate(addSchema), (req: Request, res: Response) => {
  moveRequestToWaitlist(req.body.gameId, req.body.requestId);
  res.status(201).json({ ok: true });
});

// Fill available seats from the waitlist in position order (game-wide auto-promote).
waitlistRouter.post('/promote', requireRole('admin'), validate(z.object({ gameId: z.coerce.number().int().positive() })), (req: Request, res: Response) => {
  const promoted = promoteWaitlist(req.body.gameId);
  res.json({ promotedSeats: promoted });
});

// Promote a single waitlist entry back to an open request.
waitlistRouter.post('/:id/restore', requireRole('admin'), validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  restoreFromWaitlist(id);
  res.json({ ok: true });
});

// Convenience: available seats for a game (used by reassign/manual-assign UIs).
waitlistRouter.get('/available-seats', (req: Request, res: Response) => {
  const gameId = Number(req.query.gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) throw badRequest('gameId query param required');
  const rows = db.select().from(seats).where(and(eq(seats.gameId, gameId), eq(seats.status, 'available'))).all();
  res.json({ seats: rows.map((s) => ({ id: s.id, label: seatLabel(s), section: s.section, row: s.row, seatNumber: s.seatNumber })) });
});
