import { eq } from 'drizzle-orm';
import { recomputeContactRollups } from '../../modules/attendance-service.js';
import { MOCK_PERSONAS } from '@ais/shared';
import { db } from '../client.js';
import { users, teams, seasons, games, seats, contacts, ticketRequests, requestContacts, assignments, attendanceRecords } from '../schema.js';
import { syncDirectorySnapshot } from '../../modules/directory-service.js';
import { MockDirectoryAdapter } from '../../adapters/directory/mock.js';

// Entirely synthetic; no real schedules, organizations, addresses, or directory data.
export async function seedReviewFixture() {
  const now = Date.parse('2026-10-23T12:00:00Z');
  const personas = Object.entries(MOCK_PERSONAS).map(([key, p]) => ({ key, ...db.insert(users).values({ email: p.email, fullName: p.fullName, role: p.role, passwordHash: 'mock-only-no-login', createdAt: now, updatedAt: now }).returning().get() }));
  await syncDirectorySnapshot(await new MockDirectoryAdapter().searchUsers(''), now);
  for (const [i, person] of ['employee@example.invalid', 'rep@example.invalid'].entries()) db.update(contacts).set({ phone: `+1 202 555 012${i}` }).where(eq(contacts.email, person)).run();
  const clients = ['Juniper Example Labs', 'Cobalt Sample Studio'].map((company, i) => db.insert(contacts).values({ publicId: `review-contact-${i}`, fullName: ['Alex Sample', 'Robin Example'][i], company, email: `customer${i}@example.invalid`, phone: `+1 202 555 01${String(i).padStart(2, '0')}`, type: 'customer', valueTier: i ? 'prospect' : 'gold', createdAt: now, updatedAt: now }).returning().get());
  const secondContact = db.insert(contacts).values({ publicId: 'review-contact-second', fullName: 'Quinn Sample', company: clients[0].company, email: 'quinn@example.invalid', phone: '+1 202 555 0119', type: 'customer', valueTier: 'gold', createdAt: now, updatedAt: now }).returning().get();
  const team = db.insert(teams).values({ name: 'Synthetic Comets', abbreviation: 'SYN', venue: 'Example Arena', defaultPlatform: 'mock', defaultTicketsPerGame: 4, createdAt: now }).returning().get();
  const season = db.insert(seasons).values({ teamId: team.id, label: '2026–27 Demo', status: 'active', startDate: Date.parse('2026-09-01T00:00:00Z'), endDate: Date.parse('2027-04-01T00:00:00Z'), createdAt: now }).returning().get();
  const priorSeason = db.insert(seasons).values({ teamId: team.id, label: '2025–26 Demo', status: 'completed', startDate: Date.parse('2025-09-01T00:00:00Z'), endDate: Date.parse('2026-04-01T00:00:00Z'), createdAt: now }).returning().get();
  const catalog = [
    { name: 'Example Rivals', date: '2026-11-05T03:00:00Z', release: 'private', kind: 'game', seasonId: season.id },
    { name: 'Sample Visitors', date: '2026-12-09T03:00:00Z', release: 'released', kind: 'game', seasonId: season.id },
    { name: 'Synthetic Winter Performance', date: '2026-12-15T02:00:00Z', release: 'private', kind: 'event', seasonId: season.id },
    { name: 'Past Demo Night', date: '2026-10-01T02:00:00Z', release: 'private', kind: 'game', seasonId: season.id },
    { name: 'Previous Season Example', date: '2026-03-01T02:00:00Z', release: 'private', kind: 'game', seasonId: priorSeason.id },
  ];
  const inventory = catalog.map((item) => {
    const game = db.insert(games).values({ seasonId: item.seasonId, gameDate: Date.parse(item.date), opponent: item.name, title: item.kind === 'event' ? item.name : null, kind: item.kind, releaseStatus: item.release, totalSeats: 4, createdAt: now }).returning().get();
    const pool = Array.from({ length: 4 }, (_, i) => db.insert(seats).values({ gameId: game.id, section: 'GA', row: 'GA', seatNumber: String(i + 1), createdAt: now }).returning().get());
    return { game, pool };
  });
  const coordinator = personas.find((p) => p.key === 'coordinator')!;
  const rep = personas.find((p) => p.key === 'rep')!;
  for (const [i, target] of [inventory[0], inventory[3], inventory[4]].entries()) {
    const request = db.insert(ticketRequests).values({ publicId: `review-interest-${i}`, gameId: target.game.id, requesterUserId: rep.id, requesterName: clients[0].fullName, requesterCompany: clients[0].company, requesterPhone: clients[0].phone, requesterEmail: clients[0].email, beneficiaryContactId: clients[0].id, quantity: i ? 1 : 2, notes: 'Discuss the synthetic renewal opportunity with the customer.', crmOpportunityName: 'Example renewal conversation', createdAt: now, updatedAt: now }).returning().get();
    db.insert(requestContacts).values({ requestId: request.id, contactId: clients[0].id, createdAt: now }).run();
    if (i) {
      const a = db.insert(assignments).values({ requestId: request.id, gameId: target.game.id, seatId: target.pool[0].id, beneficiaryContactId: clients[0].id, status: 'approved', assignedByUserId: coordinator.id, createdAt: now, updatedAt: now }).returning().get();
      db.update(seats).set({ status: 'assigned' }).where(eq(seats.id, target.pool[0].id)).run();
      if (i === 2) db.insert(attendanceRecords).values({ assignmentId: a.id, gameId: target.game.id, contactId: clients[0].id, ticketStatus: 'attended', designation: 'customer', recordedByUserId: coordinator.id, createdAt: now, updatedAt: now }).run();
    }
  }
  recomputeContactRollups(clients[0].id);
  return { personas, team, season, priorSeason, clients, secondContact, inventory };
}
