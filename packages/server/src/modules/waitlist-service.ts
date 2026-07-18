import { and, asc, eq, inArray } from 'drizzle-orm';
import { ACTIVE_ASSIGNMENT_STATUSES } from '@ais/shared';
import { db } from '../db/client.js';
import { waitlistEntries, ticketRequests, assignments, seats, games } from '../db/schema.js';
import { notFound } from '../lib/errors.js';

// Add a request to the tail of a game's waitlist (idempotent for active entries).
export function addToWaitlist(gameId: number, requestId: number, reason?: string): void {
  const existing = db
    .select()
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.gameId, gameId), eq(waitlistEntries.requestId, requestId), eq(waitlistEntries.status, 'active')))
    .get();
  if (existing) return;

  const active = db.select().from(waitlistEntries).where(and(eq(waitlistEntries.gameId, gameId), eq(waitlistEntries.status, 'active'))).all();
  const position = active.length + 1;
  const now = Date.now();
  db.insert(waitlistEntries)
    .values({ gameId, requestId, position, status: 'active', reason: reason ?? null, createdAt: now, updatedAt: now })
    .run();
  db.update(ticketRequests).set({ status: 'waitlisted', updatedAt: now }).where(eq(ticketRequests.id, requestId)).run();
}

// List active/promoted waitlist entries — for one game, or across all games when gameId is omitted.
export function listWaitlist(gameId?: number) {
  const conds = [inArray(waitlistEntries.status, ['active', 'promoted'])];
  if (gameId) conds.push(eq(waitlistEntries.gameId, gameId));
  return db
    .select({ entry: waitlistEntries, req: ticketRequests, game: games })
    .from(waitlistEntries)
    .leftJoin(ticketRequests, eq(waitlistEntries.requestId, ticketRequests.id))
    .leftJoin(games, eq(waitlistEntries.gameId, games.id))
    .where(and(...conds))
    .orderBy(asc(waitlistEntries.gameId), asc(waitlistEntries.position))
    .all();
}

// Manually move a request onto the waitlist: release any seats its active assignments hold
// (returning them to the pool), then queue the request.
export function moveRequestToWaitlist(gameId: number, requestId: number): void {
  const req = db.select().from(ticketRequests).where(eq(ticketRequests.id, requestId)).get();
  if (!req) throw notFound('Request not found');
  const now = Date.now();
  db.transaction(() => {
    const held = db
      .select()
      .from(assignments)
      .where(and(eq(assignments.requestId, requestId), inArray(assignments.status, ACTIVE_ASSIGNMENT_STATUSES)))
      .all();
    for (const a of held) {
      db.update(assignments).set({ status: 'cancelled', updatedAt: now }).where(eq(assignments.id, a.id)).run();
      db.update(seats).set({ status: 'available' }).where(eq(seats.id, a.seatId)).run();
    }
    addToWaitlist(gameId, requestId, 'Manually waitlisted');
  });
}

// Promote a single waitlist entry back to an open request: drop it off the waitlist and restore
// the request to an assignable state so it re-appears in the requests list.
export function restoreFromWaitlist(entryId: number): void {
  const entry = db.select().from(waitlistEntries).where(eq(waitlistEntries.id, entryId)).get();
  if (!entry) throw notFound('Waitlist entry not found');
  const req = db.select().from(ticketRequests).where(eq(ticketRequests.id, entry.requestId)).get();
  const now = Date.now();
  db.transaction(() => {
    db.update(waitlistEntries).set({ status: 'cancelled', updatedAt: now }).where(eq(waitlistEntries.id, entryId)).run();
    if (req) {
      const restored = req.priorityScore != null ? 'scored' : 'submitted';
      db.update(ticketRequests).set({ status: restored, updatedAt: now }).where(eq(ticketRequests.id, req.id)).run();
    }
  });
}

export function markPromoted(entryId: number): void {
  db.update(waitlistEntries).set({ status: 'promoted', updatedAt: Date.now() }).where(eq(waitlistEntries.id, entryId)).run();
}

export function cancelWaitlistForRequest(requestId: number): void {
  db.update(waitlistEntries)
    .set({ status: 'cancelled', updatedAt: Date.now() })
    .where(and(eq(waitlistEntries.requestId, requestId), eq(waitlistEntries.status, 'active')))
    .run();
}
