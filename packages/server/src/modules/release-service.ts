import { and, eq, gte, lte, inArray } from 'drizzle-orm';
import type { ReleaseInventoryInput, DemandSummary } from '@ais/shared';
import { db, sqlite } from '../db/client.js';
import { games } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';

// Effective visibility uses the same clock on catalog reads and request writes.
// No scheduler, notification, or database write occurs just because time passes.
export function isReleased(game: Pick<typeof games.$inferSelect, 'releaseStatus' | 'releaseAt'>, now = Date.now()): boolean {
  return game.releaseStatus === 'released' || game.releaseStatus === 'scheduled' && game.releaseAt !== null && game.releaseAt <= now;
}
export function releaseInventory(input: ReleaseInventoryInput, now = Date.now()) {
  if (input.action === 'schedule' && Date.parse(input.releaseAt!) <= now) throw badRequest('Schedule a future release instant');
  const conditions = input.gameIds
    ? [inArray(games.id, [...new Set(input.gameIds)])]
    : [gte(games.gameDate, Date.parse(input.from!)), lte(games.gameDate, Date.parse(input.through!))];
  if (input.seasonId) conditions.push(eq(games.seasonId, input.seasonId));
  return db.transaction(() => {
    const selected = db.select().from(games).where(and(...conditions)).all();
    if (input.gameIds && selected.length !== new Set(input.gameIds).size) throw notFound('One or more selected inventory items do not exist in this scope');
    if (!selected.length) throw badRequest('No inventory matches this selection');
    if (input.action !== 'private' && selected.some((g) => ['cancelled', 'completed'].includes(g.status))) throw badRequest('Completed or cancelled inventory cannot be released');
    const rows = db.update(games).set({
      releaseStatus: input.action === 'release' ? 'released' : input.action === 'schedule' ? 'scheduled' : 'private',
      releaseAt: input.action === 'schedule' ? Date.parse(input.releaseAt!) : null,
    }).where(inArray(games.id, selected.map((g) => g.id))).returning().all();
    return { games: rows, timezone: 'UTC', announcementSent: false };
  });
}
export function demandForGame(gameId: number): DemandSummary {
  // People means distinct submitting app identities, not ticket quantities or beneficiaries.
  const row = sqlite.prepare(`SELECT COUNT(*) AS requestCount,
    COUNT(DISTINCT CASE WHEN requester_user_id IS NOT NULL THEN 'user:' || requester_user_id
      ELSE 'request:' || id END) AS requestingPeople,
    COALESCE(SUM(quantity),0) AS requestedTickets FROM ticket_requests
    WHERE game_id = ? AND status NOT IN ('cancelled','declined')`).get(gameId) as DemandSummary;
  return row;
}
