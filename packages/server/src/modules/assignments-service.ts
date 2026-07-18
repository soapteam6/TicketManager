import { and, asc, eq, inArray } from 'drizzle-orm';
import { ACTIVE_ASSIGNMENT_STATUSES } from '@ais/shared';
import { db } from '../db/client.js';
import { assignments, seats, ticketRequests, waitlistEntries } from '../db/schema.js';
import { conflict, notFound, isUniqueViolation } from '../lib/errors.js';
import { scoreGame } from './scoring-service.js';
import { addToWaitlist } from './waitlist-service.js';

export function seatLabel(seat: typeof seats.$inferSelect): string {
  // Generic pool seats (section 'GA') read as "GA-12"; specific seats as "114 C-5".
  if (seat.section === 'GA') return `GA-${seat.seatNumber}`;
  return `${seat.section} ${seat.row}-${seat.seatNumber}`;
}

// Recompute a request's fulfillment status from its live assignments.
function recomputeRequestStatus(requestId: number): void {
  const req = db.select().from(ticketRequests).where(eq(ticketRequests.id, requestId)).get();
  if (!req) return;
  const active = db
    .select({ id: assignments.id, status: assignments.status })
    .from(assignments)
    .where(and(eq(assignments.requestId, requestId), inArray(assignments.status, ['approved', 'transferred'])))
    .all();
  const proposed = db
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.requestId, requestId), eq(assignments.status, 'proposed')))
    .all();

  let status = req.status;
  if (active.length >= req.quantity) status = 'fulfilled';
  else if (active.length > 0) status = 'partially_fulfilled';
  else if (proposed.length > 0) status = 'recommended';
  else if (req.status !== 'waitlisted' && req.status !== 'cancelled') status = 'scored';

  db.update(ticketRequests).set({ status, updatedAt: Date.now() }).where(eq(ticketRequests.id, requestId)).run();
}

interface AssignParams {
  requestId: number;
  seatId: number;
  status: 'proposed' | 'approved';
  userId: number;
}

// THE integrity-critical operation. Runs in an immediate transaction; the partial-unique
// index on assignments(seat_id) WHERE status active guarantees no duplicate seat assignment.
export function assignSeat({ requestId, seatId, status, userId }: AssignParams): typeof assignments.$inferSelect {
  try {
    return db.transaction((): typeof assignments.$inferSelect => {
      const seat = db.select().from(seats).where(eq(seats.id, seatId)).get();
      if (!seat) throw notFound('Seat not found');
      if (seat.status !== 'available' && seat.status !== 'held') throw conflict('Seat is not available');

      const req = db.select().from(ticketRequests).where(eq(ticketRequests.id, requestId)).get();
      if (!req) throw notFound('Request not found');
      if (req.gameId !== seat.gameId) throw conflict('Seat and request belong to different games');

      const now = Date.now();
      const inserted = db
        .insert(assignments)
        .values({
          requestId,
          seatId,
          gameId: seat.gameId,
          beneficiaryContactId: req.beneficiaryContactId ?? null,
          status,
          assignedByUserId: userId > 0 ? userId : null,
          approvedByUserId: status === 'approved' && userId > 0 ? userId : null,
          approvedAt: status === 'approved' ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

      db.update(seats).set({ status: 'assigned' }).where(eq(seats.id, seatId)).run();
      recomputeRequestStatus(requestId);
      return inserted;
    });
  } catch (err) {
    // A concurrent approval of the same seat trips the partial-unique index -> 409.
    if (isUniqueViolation(err)) throw conflict('Seat already has an active assignment');
    throw err;
  }
}

export function approveAssignment(assignmentId: number, userId: number): typeof assignments.$inferSelect {
  const a = db.select().from(assignments).where(eq(assignments.id, assignmentId)).get();
  if (!a) throw notFound('Assignment not found');
  if (a.status === 'approved' || a.status === 'transferred') return a;
  if (a.status !== 'proposed') throw conflict('Only proposed assignments can be approved');
  const now = Date.now();
  const updated = db
    .update(assignments)
    .set({ status: 'approved', approvedByUserId: userId, approvedAt: now, updatedAt: now })
    .where(eq(assignments.id, assignmentId))
    .returning()
    .get();
  recomputeRequestStatus(a.requestId);
  return updated;
}

// Decline/cancel an assignment, free its seat, and promote the waitlist for that game.
export function declineAssignment(assignmentId: number): void {
  const a = db.select().from(assignments).where(eq(assignments.id, assignmentId)).get();
  if (!a) throw notFound('Assignment not found');
  db.transaction(() => {
    db.update(assignments).set({ status: 'declined', updatedAt: Date.now() }).where(eq(assignments.id, assignmentId)).run();
    db.update(seats).set({ status: 'available' }).where(eq(seats.id, a.seatId)).run();
    recomputeRequestStatus(a.requestId);
  });
  promoteWaitlist(a.gameId);
}

export function reassign(assignmentId: number, toSeatId: number, userId: number): typeof assignments.$inferSelect {
  const a = db.select().from(assignments).where(eq(assignments.id, assignmentId)).get();
  if (!a) throw notFound('Assignment not found');
  try {
    return db.transaction((): typeof assignments.$inferSelect => {
      const toSeat = db.select().from(seats).where(eq(seats.id, toSeatId)).get();
      if (!toSeat) throw notFound('Target seat not found');
      if (toSeat.gameId !== a.gameId) throw conflict('Target seat is in a different game');
      if (toSeat.status !== 'available' && toSeat.status !== 'held') throw conflict('Target seat is not available');

      // Free the old seat, move the assignment, occupy the new seat.
      db.update(seats).set({ status: 'available' }).where(eq(seats.id, a.seatId)).run();
      const updated = db
        .update(assignments)
        .set({ seatId: toSeatId, updatedAt: Date.now() })
        .where(eq(assignments.id, assignmentId))
        .returning()
        .get();
      db.update(seats).set({ status: 'assigned' }).where(eq(seats.id, toSeatId)).run();
      return updated;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Target seat already has an active assignment');
    throw err;
  }
}

function availableSeats(gameId: number): (typeof seats.$inferSelect)[] {
  return db
    .select()
    .from(seats)
    .where(and(eq(seats.gameId, gameId), eq(seats.status, 'available')))
    .orderBy(asc(seats.id))
    .all();
}

function outstandingNeed(req: typeof ticketRequests.$inferSelect): number {
  const held = db
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.requestId, req.id), inArray(assignments.status, ACTIVE_ASSIGNMENT_STATUSES)))
    .all();
  return Math.max(0, req.quantity - held.length);
}

// Fill freed seats from the waitlist in position order.
export function promoteWaitlist(gameId: number): number {
  let promotedSeats = 0;
  const entries = db
    .select({ entry: waitlistEntries, req: ticketRequests })
    .from(waitlistEntries)
    .leftJoin(ticketRequests, eq(waitlistEntries.requestId, ticketRequests.id))
    .where(and(eq(waitlistEntries.gameId, gameId), eq(waitlistEntries.status, 'active')))
    .orderBy(asc(waitlistEntries.position))
    .all();

  for (const { entry, req } of entries) {
    if (!req || req.status === 'cancelled') continue;
    let need = outstandingNeed(req);
    while (need > 0) {
      const seat = availableSeats(gameId)[0];
      if (!seat) return promotedSeats;
      assignSeat({ requestId: req.id, seatId: seat.id, status: 'proposed', userId: 0 });
      need--;
      promotedSeats++;
    }
    if (outstandingNeed(req) === 0) {
      db.update(waitlistEntries).set({ status: 'promoted', updatedAt: Date.now() }).where(eq(waitlistEntries.id, entry.id)).run();
      db.update(ticketRequests).set({ status: 'recommended', updatedAt: Date.now() }).where(eq(ticketRequests.id, req.id)).run();
    }
  }
  return promotedSeats;
}

// Score the game, then create proposed/approved assignments for 'award' requests (up to
// available inventory) and waitlist the rest. This is the one-click allocation for admins.
export function recommendForGame(gameId: number, approve: boolean, userId: number) {
  const ranking = scoreGame(gameId);
  let assigned = 0;
  let waitlisted = 0;
  const status = approve ? 'approved' : 'proposed';

  for (const r of ranking.ranked) {
    if (r.recommendation === 'award') {
      let need = outstandingNeed(db.select().from(ticketRequests).where(eq(ticketRequests.id, r.requestId)).get()!);
      while (need > 0) {
        const seat = availableSeats(gameId)[0];
        if (!seat) break;
        assignSeat({ requestId: r.requestId, seatId: seat.id, status, userId });
        assigned++;
        need--;
      }
      if (need > 0) {
        addToWaitlist(gameId, r.requestId, 'Insufficient inventory after partial allocation');
        waitlisted++;
      }
    } else {
      addToWaitlist(gameId, r.requestId, 'Below the award cutline');
      waitlisted++;
    }
  }
  return { gameId, assigned, waitlisted, ranking };
}
