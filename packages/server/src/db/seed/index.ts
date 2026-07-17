import { eq } from 'drizzle-orm';
import {
  TEAM_SEEDS,
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_SCORING_PARAMS,
  type ValueTier,
  type ContactType,
} from '@ais/shared';
import { db, sqlite } from '../client.js';
import { runMigrations } from '../migrate.js';
import { teams, users, scoringConfigs, seasons, games, seats, contacts, ticketRequests, assignments, attendanceRecords } from '../schema.js';
import { hashPassword } from '../../lib/password.js';
import { newPublicId } from '../../lib/ids.js';
import { recomputeContactRollups } from '../../modules/attendance-service.js';
import { env } from '../../env.js';

const DAY = 24 * 60 * 60 * 1000;

async function seedTeams(): Promise<void> {
  for (const t of TEAM_SEEDS) {
    const existing = db.select().from(teams).where(eq(teams.name, t.name)).get();
    if (existing) continue;
    db.insert(teams)
      .values({
        name: t.name,
        abbreviation: t.abbreviation,
        sport: t.sport,
        venue: t.venue,
        homeGamesPerSeason: t.homeGamesPerSeason,
        defaultPlatform: t.defaultPlatform,
        isActive: 1,
        createdAt: Date.now(),
      })
      .run();
  }
  console.log(`Seeded ${TEAM_SEEDS.length} teams.`);
}

async function seedAdmin(): Promise<void> {
  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  if (db.select().from(users).where(eq(users.email, email)).get()) return;
  const now = Date.now();
  db.insert(users)
    .values({
      email,
      passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
      fullName: 'AIS Administrator',
      role: 'admin',
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  console.log(`Seeded admin: ${email}`);
  if (env.SEED_ADMIN_PASSWORD === 'ChangeMe123!') console.warn('WARNING: using the default admin password. Change it in .env.');
}

async function seedScoring(): Promise<void> {
  if (db.select().from(scoringConfigs).get()) return;
  db.insert(scoringConfigs)
    .values({
      name: 'Default 2025-26',
      isActive: 1,
      version: 1,
      weights: JSON.stringify(DEFAULT_SCORING_WEIGHTS),
      params: JSON.stringify(DEFAULT_SCORING_PARAMS),
      createdAt: Date.now(),
    })
    .run();
  console.log('Seeded default scoring config.');
}

async function ensureUser(email: string, fullName: string, role: 'sales_rep' | 'employee'): Promise<number> {
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) return existing.id;
  const now = Date.now();
  return db
    .insert(users)
    .values({ email, passwordHash: await hashPassword('ChangeMe123!'), fullName, role, isActive: 1, createdAt: now, updatedAt: now })
    .returning()
    .get().id;
}

interface ContactSpec {
  name: string;
  company?: string;
  type: ContactType;
  tier: ValueTier;
  attended: number;
  awarded: number;
  noShow: number;
  lastDaysAgo: number | null;
  business: number;
}

const CONTACTS: ContactSpec[] = [
  { name: 'Alice Nguyen', company: 'Summit Realty', type: 'customer', tier: 'platinum', attended: 9, awarded: 10, noShow: 0, lastDaysAgo: 60, business: 145000 },
  { name: 'Marcus Bell', company: 'Bell Logistics', type: 'customer', tier: 'gold', attended: 6, awarded: 8, noShow: 1, lastDaysAgo: 30, business: 82000 },
  { name: 'Priya Shah', company: 'Desert Financial', type: 'customer', tier: 'gold', attended: 4, awarded: 5, noShow: 0, lastDaysAgo: 120, business: 61000 },
  { name: 'Tom Alvarez', company: 'Alvarez Construction', type: 'customer', tier: 'silver', attended: 3, awarded: 6, noShow: 2, lastDaysAgo: 15, business: 28000 },
  { name: 'Grace Kim', company: 'Kim & Partners', type: 'customer', tier: 'silver', attended: 2, awarded: 2, noShow: 0, lastDaysAgo: 200, business: 33000 },
  { name: 'David Osei', company: 'Osei Ventures', type: 'customer', tier: 'bronze', attended: 1, awarded: 3, noShow: 1, lastDaysAgo: 45, business: 12000 },
  { name: 'Sara Lopez', company: 'Lopez Media', type: 'customer', tier: 'bronze', attended: 0, awarded: 1, noShow: 1, lastDaysAgo: 90, business: 4000 },
  { name: 'Ken Tanaka', company: 'Tanaka Imports', type: 'customer', tier: 'prospect', attended: 0, awarded: 0, noShow: 0, lastDaysAgo: null, business: 0 },
  { name: 'Rita Flores', company: 'Flores Group', type: 'customer', tier: 'gold', attended: 5, awarded: 5, noShow: 0, lastDaysAgo: 10, business: 70000 },
  { name: 'Omar Haddad', company: 'Haddad Auto', type: 'customer', tier: 'platinum', attended: 8, awarded: 9, noShow: 1, lastDaysAgo: 75, business: 128000 },
  { name: 'Jenny Park', company: 'Skyline Hotels', type: 'customer', tier: 'silver', attended: 3, awarded: 4, noShow: 0, lastDaysAgo: 150, business: 41000 },
  { name: 'Carlos Mendez', type: 'employee', tier: 'prospect', attended: 2, awarded: 3, noShow: 0, lastDaysAgo: 40, business: 0 },
  { name: 'Beth Carter', type: 'employee', tier: 'prospect', attended: 1, awarded: 2, noShow: 1, lastDaysAgo: 80, business: 0 },
  { name: 'Frank Wu', type: 'employee', tier: 'prospect', attended: 3, awarded: 3, noShow: 0, lastDaysAgo: 20, business: 0 },
  { name: 'Nina Patel', type: 'employee', tier: 'prospect', attended: 0, awarded: 1, noShow: 0, lastDaysAgo: 110, business: 0 },
];

const OPPONENTS = ['Colorado Avalanche', 'Edmonton Oilers', 'Dallas Stars', 'Seattle Kraken', 'LA Kings', 'San Jose Sharks', 'Anaheim Ducks', 'Chicago Blackhawks'];

async function seedDemo(): Promise<void> {
  const vgk = db.select().from(teams).where(eq(teams.abbreviation, 'VGK')).get();
  if (!vgk) return;
  const seasonLabel = '2025-26 Season';
  if (db.select().from(seasons).where(eq(seasons.label, seasonLabel)).get()) {
    console.log('Demo already seeded; skipping.');
    return;
  }

  const repId = await ensureUser('rep@ais.local', 'Sam Rivera (Sales Rep)', 'sales_rep');
  const empId = await ensureUser('employee@ais.local', 'Jordan Lee (Employee)', 'employee');
  const now = Date.now();

  const season = db
    .insert(seasons)
    .values({ teamId: vgk.id, label: seasonLabel, startDate: now - 30 * DAY, endDate: now + 180 * DAY, status: 'active', createdAt: now })
    .returning()
    .get();

  // Set a realistic 7:00 PM local start time on a given day offset.
  const eveningOn = (offsetDays: number): number => {
    const d = new Date(now + offsetDays * DAY);
    d.setHours(19, 0, 0, 0);
    return d.getTime();
  };

  // 1 past game (for reconciliation) + 7 upcoming games.
  const gameOffsets = [-10, 5, 12, 19, 26, 33, 40, 47];
  const gameRows = gameOffsets.map((off, i) =>
    db
      .insert(games)
      .values({
        seasonId: season.id,
        gameDate: eveningOn(off),
        opponent: OPPONENTS[i % OPPONENTS.length],
        promotions: i % 3 === 0 ? 'Giveaway Night' : i % 3 === 1 ? 'Theme Night' : '',
        status: off < 0 ? 'completed' : 'scheduled',
        totalSeats: 0,
        premiumScore: off < 0 ? 0.5 : [0.9, 0.4, 0.5, 0.8, 0.3, 0.6, 0.7][i % 7] ?? 0.5,
        createdAt: now,
      })
      .returning()
      .get()
  );

  // Seat block per game (6 seats — deliberately scarce to exercise waitlists).
  for (const g of gameRows) {
    for (let n = 1; n <= 6; n++) {
      db.insert(seats).values({ gameId: g.id, section: 'Club', row: 'A', seatNumber: String(n), isAda: 0, status: 'available', createdAt: now }).run();
    }
    db.update(games).set({ totalSeats: 6 }).where(eq(games.id, g.id)).run();
  }

  // Contacts with history.
  const contactIds: number[] = [];
  for (const c of CONTACTS) {
    const row = db
      .insert(contacts)
      .values({
        publicId: newPublicId(),
        type: c.type,
        fullName: c.name,
        company: c.company ?? null,
        email: `${c.name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
        valueTier: c.tier,
        lifetimeBusinessGenerated: c.business,
        lastTicketDate: c.lastDaysAgo == null ? null : now - c.lastDaysAgo * DAY,
        attendedCount: c.attended,
        awardedCount: c.awarded,
        noShowCount: c.noShow,
        accountOwnerUserId: c.type === 'customer' ? repId : null,
        futurePriorityFlag: 'normal',
        isActive: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    contactIds.push(row.id);
  }

  // ~20 requests across the upcoming games, plus requests on the past game.
  const upcoming = gameRows.filter((g) => g.gameDate >= now);
  let reqCount = 0;
  for (let i = 0; i < 22; i++) {
    const game = upcoming[i % upcoming.length];
    const contactIdx = i % contactIds.length;
    const cSpec = CONTACTS[contactIdx];
    db.insert(ticketRequests)
      .values({
        publicId: newPublicId(),
        gameId: game.id,
        requesterUserId: cSpec.type === 'employee' ? empId : repId,
        requesterName: cSpec.name,
        requesterCompany: cSpec.company ?? null,
        beneficiaryContactId: contactIds[contactIdx],
        beneficiaryType: cSpec.type,
        quantity: (i % 3) + 1,
        salesOpportunityUsd: cSpec.type === 'customer' ? [0, 5000, 15000, 40000][i % 4] : 0,
        notes: '',
        status: 'submitted',
        source: i % 5 === 0 ? 'email_intake' : 'manual',
        createdAt: now - (i % 7) * DAY,
        updatedAt: now,
      })
      .run();
    reqCount++;
  }

  // Reconcile the past game: award 6 seats, transfer, and record attendance.
  const pastGame = gameRows.find((g) => g.gameDate < now)!;
  const pastSeats = db.select().from(seats).where(eq(seats.gameId, pastGame.id)).all();
  for (let s = 0; s < pastSeats.length; s++) {
    const contactIdx = s % contactIds.length;
    const cSpec = CONTACTS[contactIdx];
    const req = db
      .insert(ticketRequests)
      .values({
        publicId: newPublicId(),
        gameId: pastGame.id,
        requesterUserId: cSpec.type === 'employee' ? empId : repId,
        requesterName: cSpec.name,
        beneficiaryContactId: contactIds[contactIdx],
        beneficiaryType: cSpec.type,
        quantity: 1,
        salesOpportunityUsd: 0,
        status: 'fulfilled',
        source: 'manual',
        createdAt: now - 20 * DAY,
        updatedAt: now,
      })
      .returning()
      .get();
    const asg = db
      .insert(assignments)
      .values({
        requestId: req.id,
        seatId: pastSeats[s].id,
        gameId: pastGame.id,
        beneficiaryContactId: contactIds[contactIdx],
        status: 'transferred',
        transferRef: `MOCK-${req.id}`,
        transferPlatform: 'ticketmaster',
        transferredAt: now - 12 * DAY,
        createdAt: now - 15 * DAY,
        updatedAt: now,
      })
      .returning()
      .get();
    db.update(seats).set({ status: 'transferred' }).where(eq(seats.id, pastSeats[s].id)).run();
    const attended = s % 4 !== 0; // most attended, some no-show
    db.insert(attendanceRecords)
      .values({
        assignmentId: asg.id,
        gameId: pastGame.id,
        contactId: contactIds[contactIdx],
        ticketStatus: attended ? 'attended' : 'no_show',
        designation: cSpec.type,
        salesRepUserId: cSpec.type === 'customer' ? repId : null,
        businessGenerated: attended && cSpec.type === 'customer' ? [0, 8000, 22000][s % 3] : 0,
        followUpNotes: attended ? 'Positive engagement; follow up on renewal.' : 'No-show; deprioritize next cycle.',
        futurePriority: attended ? 'normal' : 'deprioritized',
        recordedByUserId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  for (const cid of contactIds) recomputeContactRollups(cid);

  console.log(`Seeded demo: 1 active season, ${gameRows.length} games, ${CONTACTS.length} contacts, ${reqCount + pastSeats.length} requests, 1 reconciled game.`);
}

async function main(): Promise<void> {
  runMigrations(sqlite);
  // Base seed is a clean slate: an admin account and a default scoring config. Sample teams and
  // the full demo dataset are only created with SEED_DEMO=true (npm run seed:demo).
  await seedAdmin();
  await seedScoring();
  if (env.SEED_DEMO || process.env.SEED_DEMO === 'true') {
    await seedTeams();
    await seedDemo();
  }
  console.log('Seeding complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
