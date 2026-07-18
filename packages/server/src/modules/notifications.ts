import { Router, type Request, type Response } from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { NOTIFY_AUDIENCE } from '@ais/shared';
import { db } from '../db/client.js';
import { seats, games } from '../db/schema.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { logIntegration } from '../adapters/integration-log.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

const AUDIENCE_LABEL: Record<(typeof NOTIFY_AUDIENCE)[number], string> = {
  everyone: 'Everyone',
  sales_team: 'Sales team',
};

// Available seats across upcoming (scheduled / transfer-pending) games, and how many games have any.
function availabilitySummary() {
  const rows = db
    .select({ gameId: seats.gameId })
    .from(seats)
    .innerJoin(games, eq(seats.gameId, games.id))
    .where(and(eq(seats.status, 'available'), inArray(games.status, ['scheduled', 'transfer_pending'])))
    .all();
  const availableSeats = rows.length;
  const gamesWithAvailability = new Set(rows.map((r) => r.gameId)).size;
  return { availableSeats, gamesWithAvailability };
}

function defaultMessage(availableSeats: number, gamesWithAvailability: number): string {
  if (availableSeats === 0) return 'No tickets are currently available.';
  return `${availableSeats} ticket${availableSeats === 1 ? '' : 's'} available across ${gamesWithAvailability} upcoming game${
    gamesWithAvailability === 1 ? '' : 's'
  }. Reply to claim yours.`;
}

// Preview: seat availability + a suggested message to pre-fill the composer.
notificationsRouter.get('/availability', (_req: Request, res: Response) => {
  const summary = availabilitySummary();
  res.json({ ...summary, message: defaultMessage(summary.availableSeats, summary.gamesWithAvailability) });
});

const sendSchema = z.object({
  audience: z.enum(NOTIFY_AUDIENCE),
  message: z.string().min(1).max(2000),
});

// Send an availability broadcast to the chosen audience. Recorded as an integration log entry.
notificationsRouter.post('/availability', requireRole('admin'), validate(sendSchema), (req: Request, res: Response) => {
  const { audience, message } = req.body as z.infer<typeof sendSchema>;
  const summary = availabilitySummary();
  logIntegration({
    adapter: 'notification',
    operation: `availability-broadcast:${audience}`,
    status: 'success',
    payload: { audience: AUDIENCE_LABEL[audience], ...summary },
    response: { message },
  });
  res.json({ ok: true, audience, audienceLabel: AUDIENCE_LABEL[audience], ...summary });
});
