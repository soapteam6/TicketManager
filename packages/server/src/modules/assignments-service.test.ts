import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { teams, seasons, games, seats, ticketRequests, users } from '../db/schema.js';
import { assignSeat, declineAssignment, promoteWaitlist } from './assignments-service.js';
import { addToWaitlist } from './waitlist-service.js';
import { HttpError } from '../lib/errors.js';

let gameId: number;
let seatId: number;
let requestA: number;
let requestB: number;
let adminId: number;

beforeAll(() => {
  runMigrations(sqlite);
  const now = Date.now();
  adminId = db.insert(users).values({ email: 'admin-test@ais.local', passwordHash: 'x', fullName: 'Admin', role: 'admin', isActive: 1, createdAt: now, updatedAt: now }).returning().get().id;
  const team = db.insert(teams).values({ name: 'Test Team', abbreviation: 'TT', homeGamesPerSeason: 10, defaultPlatform: 'mock', isActive: 1, createdAt: now }).returning().get();
  const season = db.insert(seasons).values({ teamId: team.id, label: 'Test Season', startDate: now, endDate: now + 1000, status: 'active', createdAt: now }).returning().get();
  const game = db.insert(games).values({ seasonId: season.id, gameDate: now + 1000, opponent: 'Rival', status: 'scheduled', totalSeats: 1, premiumScore: 0.5, createdAt: now }).returning().get();
  gameId = game.id;
  seatId = db.insert(seats).values({ gameId, section: 'A', row: '1', seatNumber: '1', isAda: 0, status: 'available', createdAt: now }).returning().get().id;
  requestA = db.insert(ticketRequests).values({ publicId: 'req-a', gameId, beneficiaryType: 'customer', quantity: 1, salesOpportunityUsd: 0, status: 'submitted', source: 'manual', createdAt: now, updatedAt: now }).returning().get().id;
  requestB = db.insert(ticketRequests).values({ publicId: 'req-b', gameId, beneficiaryType: 'customer', quantity: 1, salesOpportunityUsd: 0, status: 'submitted', source: 'manual', createdAt: now, updatedAt: now }).returning().get().id;
});

describe('seat assignment integrity', () => {
  it('assigns a seat and marks the request fulfilled', () => {
    const a = assignSeat({ requestId: requestA, seatId, status: 'approved', userId: adminId });
    expect(a.status).toBe('approved');
    const seat = db.select().from(seats).where(eq(seats.id, seatId)).get();
    expect(seat?.status).toBe('assigned');
    const req = db.select().from(ticketRequests).where(eq(ticketRequests.id, requestA)).get();
    expect(req?.status).toBe('fulfilled');
  });

  it('BLOCKS a second active assignment on the same seat (no duplicates)', () => {
    // The partial-unique index on assignments(seat_id) WHERE status active guarantees this.
    let threw: unknown;
    try {
      assignSeat({ requestId: requestB, seatId, status: 'approved', userId: adminId });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(HttpError);
    expect((threw as HttpError).status).toBe(409);
  });

  it('frees the seat on decline and promotes the waitlist', () => {
    // Waitlist request B, then decline A's assignment -> B should get the freed seat.
    addToWaitlist(gameId, requestB);
    const aRow = db.select().from(ticketRequests).where(eq(ticketRequests.id, requestA)).get();
    expect(aRow?.status).toBe('fulfilled');

    // Decline via the seat's current assignment.
    const seatAssignment = sqlite
      .prepare(`SELECT id FROM assignments WHERE seat_id = ? AND status = 'approved'`)
      .get(seatId) as { id: number } | undefined;
    expect(seatAssignment).toBeTruthy();
    declineAssignment(seatAssignment!.id);

    // Promotion should have created a proposed assignment for B on the freed seat.
    promoteWaitlist(gameId);
    const bAssignments = sqlite
      .prepare(`SELECT COUNT(*) as c FROM assignments WHERE request_id = ? AND status IN ('proposed','approved','transferred')`)
      .get(requestB) as { c: number };
    expect(bAssignments.c).toBeGreaterThanOrEqual(1);
  });
});
