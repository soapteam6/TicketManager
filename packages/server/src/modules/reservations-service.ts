import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { reservations, seats } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { seatLabel } from './assignments-service.js';

// Release any offered reservations whose deadline has passed: mark expired and free their seats.
export function expireDueReservations(gameId?: number): number {
  const now = Date.now();
  const conds = [eq(reservations.status, 'offered'), lt(reservations.expiresAt, now)];
  if (gameId) conds.push(eq(reservations.gameId, gameId));
  const due = db.select().from(reservations).where(and(...conds)).all();
  if (due.length === 0) return 0;
  db.transaction(() => {
    for (const r of due) {
      db.update(reservations).set({ status: 'expired', updatedAt: now }).where(eq(reservations.id, r.id)).run();
      db.update(seats).set({ status: 'available' }).where(eq(seats.id, r.seatId)).run();
    }
  });
  return due.length;
}

export function listReservations(gameId: number) {
  expireDueReservations(gameId);
  return db
    .select({ res: reservations, seat: seats })
    .from(reservations)
    .leftJoin(seats, eq(reservations.seatId, seats.id))
    .where(eq(reservations.gameId, gameId))
    .orderBy(desc(reservations.createdAt))
    .all()
    .map(({ res, seat }) => ({ ...res, seatLabel: seat ? seatLabel(seat) : null }));
}

interface CreateReservationParams {
  gameId: number;
  personName: string;
  personEmail?: string;
  ticketType?: string;
  quantity: number;
  expiresAt: number;
  userId: number;
}

// Offer up to `quantity` available seats (optionally of a ticket type) to a person. Each held seat
// becomes one reservation. Returns the created reservations.
export function createReservations(p: CreateReservationParams) {
  return db.transaction(() => {
    const conds = [eq(seats.gameId, p.gameId), eq(seats.status, 'available')];
    if (p.ticketType) conds.push(eq(seats.ticketType, p.ticketType));
    const available = db.select().from(seats).where(and(...conds)).orderBy(asc(seats.id)).all();
    if (available.length === 0) throw conflict('No available seats to reserve.');

    const now = Date.now();
    const created = [];
    for (const seat of available.slice(0, p.quantity)) {
      const row = db
        .insert(reservations)
        .values({
          gameId: p.gameId,
          seatId: seat.id,
          personName: p.personName,
          personEmail: p.personEmail ?? null,
          ticketType: seat.ticketType,
          status: 'offered',
          expiresAt: p.expiresAt,
          createdByUserId: p.userId > 0 ? p.userId : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      db.update(seats).set({ status: 'held' }).where(eq(seats.id, seat.id)).run();
      created.push(row);
    }
    return created;
  });
}

export function claimReservation(id: number) {
  const r = db.select().from(reservations).where(eq(reservations.id, id)).get();
  if (!r) throw notFound('Reservation not found');
  if (r.status === 'reserved') return r;
  if (r.status !== 'offered') throw conflict('Only offered reservations can be reserved.');
  if (r.expiresAt < Date.now()) {
    // Past the deadline — expire it instead of letting it be claimed.
    expireDueReservations(r.gameId);
    throw conflict('This offer has expired.');
  }
  const now = Date.now();
  return db.update(reservations).set({ status: 'reserved', reservedAt: now, updatedAt: now }).where(eq(reservations.id, id)).returning().get();
}

// Manually release an active reservation (offered or reserved): free the seat back to the pool.
export function releaseReservation(id: number) {
  const r = db.select().from(reservations).where(eq(reservations.id, id)).get();
  if (!r) throw notFound('Reservation not found');
  if (!(['offered', 'reserved'] as string[]).includes(r.status)) throw conflict('Reservation is not active.');
  const now = Date.now();
  db.transaction(() => {
    db.update(reservations).set({ status: 'released', updatedAt: now }).where(eq(reservations.id, id)).run();
    db.update(seats).set({ status: 'available' }).where(eq(seats.id, r.seatId)).run();
  });
}
