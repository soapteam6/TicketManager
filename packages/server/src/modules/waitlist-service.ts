import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { waitlistEntries, ticketRequests } from '../db/schema.js';

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

export function listWaitlist(gameId: number) {
  return db
    .select({ entry: waitlistEntries, req: ticketRequests })
    .from(waitlistEntries)
    .leftJoin(ticketRequests, eq(waitlistEntries.requestId, ticketRequests.id))
    .where(and(eq(waitlistEntries.gameId, gameId), inArray(waitlistEntries.status, ['active', 'promoted'])))
    .orderBy(asc(waitlistEntries.position))
    .all();
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
