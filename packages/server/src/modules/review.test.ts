import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';
import { db, sqlite } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { seedReviewFixture } from '../db/seed/review-fixture.js';
import { assignments, contacts, games, ticketRequests, seats } from '../db/schema.js';
import { isReleased, releaseInventory } from './release-service.js';
import { releaseInventorySchema, DEFAULT_SCORING_WEIGHTS } from '@ais/shared';
import { scoreGame } from './scoring-service.js';
import { env } from '../env.js';

const app = createApp();
const NOW = Date.parse('2026-10-23T12:00:00Z');
let fixture: Awaited<ReturnType<typeof seedReviewFixture>>;
const rep = (r: request.Test) => r.set('x-mock-persona', 'rep');
const employee = (r: request.Test) => r.set('x-mock-persona', 'employee');
const createInterest = (gameId: number, contactId: number, extra: object = {}) => ({ gameId, beneficiaryType: 'customer', beneficiaryContactId: contactId, quantity: 2, notes: 'Discuss a synthetic renewal opportunity.', ...extra });
beforeAll(() => runMigrations(sqlite));
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  for (const table of ['attendance_records','allocation_decisions','assignments','waitlist_entries','request_contacts','reservations','ticket_requests','seats','games','seasons','teams','contacts','refresh_tokens','scoring_configs','users','integration_logs','review_settings','mock_outbox']) sqlite.exec(`DELETE FROM ${table}`);
  fixture = await seedReviewFixture();
});
afterEach(() => vi.useRealTimers());

describe('local mock role boundaries and release', () => {
  it('fails closed outside explicit mock mode, rejects invalid persona and denies coordinator endpoints to requesters', async () => {
    const saved = env.LOCAL_MOCK_MODE; env.LOCAL_MOCK_MODE = false;
    try { await request(app).get('/api/games').expect(503); } finally { env.LOCAL_MOCK_MODE = saved; }
    await request(app).get('/api/games').set('x-mock-persona','admin').expect(401);
    for (const path of ['/contacts','/directory/search?q=demo','/assignments','/scoring/configs','/teams','/events','/dashboards/overview','/review/outbox',`/games/${fixture.inventory[0].game.id}/seats`]) await rep(request(app).get(`/api${path}`)).expect(403);
    await rep(request(app).post('/api/review/releases')).send({ action:'release', gameIds:[fixture.inventory[0].game.id] }).expect(403);
  });
  it('hides private inventory, rejects direct private interest, and keeps internal fields out of public responses', async () => {
    const privateId = fixture.inventory[0].game.id;
    const catalog = await rep(request(app).get('/api/games')).expect(200);
    expect(catalog.body.games.map((g: { id: number }) => g.id)).toEqual([fixture.inventory[1].game.id]);
    expect(catalog.body.games[0]).not.toHaveProperty('notes');
    expect(catalog.body.games[0]).not.toHaveProperty('premiumScore');
    await rep(request(app).get(`/api/games/${privateId}`)).expect(404);
    await rep(request(app).post('/api/requests')).send(createInterest(privateId, fixture.clients[0].id)).expect(404);
    const coordinator = await request(app).post('/api/requests').send(createInterest(privateId, fixture.clients[0].id)).expect(201);
    expect(coordinator.body.interestOnly).toBe(true);
    expect(db.select().from(assignments).where(eq(assignments.requestId,coordinator.body.request.id)).all()).toHaveLength(0);
  });
  it('releases individually, by batch and date window without any announcement', async () => {
    const ids = [fixture.inventory[0].game.id, fixture.inventory[2].game.id];
    await request(app).post('/api/review/releases').send({ action:'release',gameIds:ids }).expect(200);
    expect((await rep(request(app).get('/api/games'))).body.games).toHaveLength(3);
    await request(app).post('/api/review/releases').send({ action:'private', from:'2026-11-01T00:00:00Z', through:'2026-12-31T23:59:59Z' }).expect(200);
    expect((await rep(request(app).get('/api/games'))).body.games).toHaveLength(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM mock_outbox').get()).toEqual({ n:0 });
    // Invalid selection is atomic, never a partial release.
    await request(app).post('/api/review/releases').send({ action:'release',gameIds:[ids[0],999999] }).expect(404);
    expect(db.select().from(games).where(eq(games.id,ids[0])).get()?.releaseStatus).toBe('private');
  });
  it('makes timezone semantics explicit and applies the exact scheduled boundary on both reads and submission', async () => {
    const gameId = fixture.inventory[0].game.id;
    expect(releaseInventorySchema.safeParse({ action:'schedule',gameIds:[gameId],releaseAt:'2026-10-24T09:00' }).success).toBe(false);
    const scheduled = releaseInventory(releaseInventorySchema.parse({ action:'schedule',gameIds:[gameId],releaseAt:'2026-10-24T09:00:00-07:00' }), NOW).games[0];
    const instant = Date.parse('2026-10-24T16:00:00Z');
    expect(scheduled.releaseAt).toBe(instant);
    expect(isReleased(scheduled,instant-1)).toBe(false); expect(isReleased(scheduled,instant)).toBe(true);
    vi.setSystemTime(instant-1);
    await rep(request(app).post('/api/requests')).send(createInterest(gameId,fixture.clients[0].id)).expect(404);
    vi.setSystemTime(instant);
    expect((await rep(request(app).get('/api/games'))).body.games.some((g: { id:number })=>g.id===gameId)).toBe(true);
    await rep(request(app).post('/api/requests')).send(createInterest(gameId,fixture.clients[0].id)).expect(201);
  });
});

describe('interest, contact privacy and discretionary assignment', () => {
  it('counts requests, distinct submitting people and ticket quantities separately, without exposing other requests or scores', async () => {
    const gameId = fixture.inventory[1].game.id;
    const first = await rep(request(app).post('/api/requests')).send(createInterest(gameId,fixture.clients[0].id)).expect(201);
    await rep(request(app).post('/api/requests')).send(createInterest(gameId,fixture.clients[0].id,{quantity:1})).expect(201);
    const self = db.select().from(contacts).where(eq(contacts.email,'employee@example.invalid')).get()!;
    const second = await employee(request(app).post('/api/requests')).send(createInterest(gameId,self.id,{quantity:3,beneficiaryType:'employee'})).expect(201);
    const catalog = (await employee(request(app).get('/api/games'))).body.games[0];
    expect(catalog).toMatchObject({ requestCount:3,requestingPeople:2,requestedTickets:6,availableSeats:4 });
    const own = await employee(request(app).get('/api/requests?mine=false')).expect(200);
    expect(own.body.requests).toHaveLength(1); expect(own.body.requests[0].id).toBe(second.body.request.id);
    expect(own.body.requests[0]).not.toHaveProperty('priorityScore');
    expect(first.body.request).not.toHaveProperty('scoringBreakdown');
    await employee(request(app).get(`/api/requests/${first.body.request.id}`)).expect(404);
    expect(db.select().from(assignments).where(eq(assignments.gameId,gameId)).all()).toHaveLength(0);
  });
  it('supports multiple contacts, optional opportunity and on-behalf attribution without allowing requester impersonation', async () => {
    const gameId = fixture.inventory[1].game.id;
    const repId = fixture.personas.find((p)=>p.key==='rep')!.id;
    const result = await request(app).post('/api/requests').send(createInterest(gameId,fixture.clients[0].id,{ onBehalfUserId:repId,crmOpportunityName:'Synthetic MRR discussion',beneficiaryContacts:[fixture.clients[0],fixture.secondContact].map((c)=>({localContactId:c.id,fullName:c.fullName})) })).expect(201);
    expect(result.body.request.requesterUserId).toBe(repId);
    expect(result.body.request.requesterPhone).toBe(fixture.clients[0].phone);
    const detail = await request(app).get(`/api/requests/${result.body.request.id}`).expect(200);
    expect(detail.body.request.beneficiaries).toHaveLength(2);
    await rep(request(app).post('/api/requests')).send(createInterest(gameId,fixture.clients[0].id,{onBehalfUserId:repId})).expect(403);
    await employee(request(app).post('/api/requests')).send(createInterest(gameId,fixture.clients[0].id)).expect(403);
    await rep(request(app).post('/api/requests')).send(createInterest(gameId,fixture.clients[0].id,{notes:''})).expect(400);
  });
  it('rejects inactive contacts including secondary selections, and preserves an app override across synthetic sync', async () => {
    const self = db.select().from(contacts).where(eq(contacts.email,'employee@example.invalid')).get()!;
    await request(app).patch(`/api/contacts/${self.id}`).send({isActive:false}).expect(200);
    await request(app).post('/api/directory/sync-mock').expect(200);
    const after = db.select().from(contacts).where(eq(contacts.id,self.id)).get()!;
    expect(after.isActive).toBe(0); expect(after.directoryActive).toBe(1);
    expect((await employee(request(app).get('/api/request-options'))).body.contacts).toHaveLength(0);
    await employee(request(app).post('/api/requests')).send(createInterest(fixture.inventory[1].game.id,self.id,{beneficiaryType:'employee'})).expect(400);
    await request(app).patch(`/api/contacts/${fixture.secondContact.id}`).send({isActive:false}).expect(200);
    await rep(request(app).post('/api/requests')).send(createInterest(fixture.inventory[1].game.id,fixture.clients[0].id,{beneficiaryContacts:[fixture.clients[0],fixture.secondContact].map((c)=>({localContactId:c.id,fullName:c.fullName}))})).expect(400);
    const historic = await request(app).get(`/api/contacts/${fixture.clients[0].id}/history`).expect(200);
    expect(historic.body.assignments).toHaveLength(2);
    expect(historic.body.attendance).toHaveLength(1);
  });
  it('makes allocation atomic, limits it to requested quantity and prevents overselling and duplicate assignments', async () => {
    const gameId = fixture.inventory[1].game.id;
    const interest = await rep(request(app).post('/api/requests')).send(createInterest(gameId,fixture.clients[0].id)).expect(201);
    const id = interest.body.request.id;
    await request(app).post('/api/review/allocate').send({requestId:id,quantity:3,reason:'Human override'}).expect(409);
    expect(db.select().from(assignments).where(eq(assignments.requestId,id)).all()).toHaveLength(0);
    const results = await Promise.all([1,2].map(()=>request(app).post('/api/review/allocate').send({requestId:id,quantity:2,reason:'Relationship context takes priority'})));
    expect(results.map((r)=>r.status).sort()).toEqual([201,409]);
    expect(db.select().from(assignments).where(eq(assignments.requestId,id)).all()).toHaveLength(2);
    await request(app).patch(`/api/requests/${id}`).send({quantity:1}).expect(409);
    expect(db.select().from(seats).where(eq(seats.gameId,gameId)).all().filter((s)=>s.status==='available')).toHaveLength(2);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM allocation_decisions WHERE request_id=?').get(id)).toEqual({n:1});
  });
  it('protects reservation holds and expires them before publishing available counts', async () => {
    const gameId = fixture.inventory[1].game.id;
    const hold = await request(app).post(`/api/games/${gameId}/reservations`).send({personName:'Synthetic reserved person',quantity:3,expiresAt:'2026-10-24T12:00:00Z'}).expect(201);
    expect(hold.body.created).toBe(3);
    const interest = await rep(request(app).post('/api/requests')).send(createInterest(gameId,fixture.clients[0].id)).expect(201);
    await request(app).post('/api/review/allocate').send({requestId:interest.body.request.id,quantity:2,reason:'Held tickets cannot be assigned'}).expect(409);
    expect((await rep(request(app).get('/api/games'))).body.games[0].availableSeats).toBe(1);
    vi.setSystemTime(Date.parse('2026-10-24T12:00:01Z'));
    expect((await rep(request(app).get('/api/games'))).body.games[0].availableSeats).toBe(4);
    await request(app).post('/api/review/allocate').send({requestId:interest.body.request.id,quantity:2,reason:'Hold expired, coordinator decides allocation'}).expect(201);
  });
  it('refuses allocation when a previously selected beneficiary becomes inactive', async () => {
    const interest = await rep(request(app).post('/api/requests')).send(createInterest(fixture.inventory[1].game.id,fixture.clients[0].id)).expect(201);
    await request(app).patch(`/api/contacts/${fixture.clients[0].id}`).send({isActive:false}).expect(200);
    await request(app).post('/api/review/allocate').send({requestId:interest.body.request.id,quantity:1,reason:'Cannot allocate inactive person'}).expect(409);
  });
});

describe('complete local flow and non-delivery guarantees', () => {
  it('runs private inventory → interest → manual allocation → transfer record → attendance and retained history', async () => {
    const created = await request(app).post('/api/events').send({title:'Synthetic Performance',date:'2026-10-22T19:00:00Z',tickets:2}).expect(201);
    const gameId = created.body.game.id;
    expect(created.body.game.releaseStatus).toBe('private');
    const interest = await request(app).post('/api/requests').send(createInterest(gameId,fixture.clients[0].id,{quantity:1})).expect(201);
    const allocated = await request(app).post('/api/review/allocate').send({requestId:interest.body.request.id,quantity:1,reason:'Coordinator choice, before public release'}).expect(201);
    const id = allocated.body.assignments[0].id;
    await request(app).post(`/api/assignments/${id}/transfer`).expect(400);
    const transfer = await request(app).post('/api/review/manual-transfer').send({assignmentId:id,confirmed:true,reference:'Synthetic provider-app confirmation'}).expect(200);
    expect(transfer.body.providerContacted).toBe(false);
    await request(app).post(`/api/assignments/${id}/attendance`).send({ticketStatus:'unknown'}).expect(200);
    expect(db.select().from(contacts).where(eq(contacts.id,fixture.clients[0].id)).get()?.noShowCount).toBe(0);
    await request(app).post(`/api/assignments/${id}/attendance`).send({ticketStatus:'no_show'}).expect(400);
    await request(app).post(`/api/assignments/${id}/attendance`).send({ticketStatus:'no_show',followUpNotes:'Synthetic explicit confirmation from coordinator'}).expect(200);
    expect(db.select().from(contacts).where(eq(contacts.id,fixture.clients[0].id)).get()?.noShowCount).toBe(1);
    await request(app).post(`/api/assignments/${id}/attendance`).send({ticketStatus:'attended',followUpNotes:'Corrected with attendance confirmation'}).expect(200);
    expect(db.select().from(contacts).where(eq(contacts.id,fixture.clients[0].id)).get()?.noShowCount).toBe(0);
    await request(app).delete(`/api/contacts/${fixture.clients[0].id}`).expect(200);
    const history = await request(app).get(`/api/contacts/${fixture.clients[0].id}/history`).expect(200);
    expect(history.body.contact.isActive).toBe(0); expect(history.body.attendance).toHaveLength(2);
    expect(history.body.assignments).toHaveLength(3);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  it('only creates local announcement previews on explicit choice and keeps follow-up disabled until opted in', async () => {
    expect((await request(app).get('/api/review/followup')).body.template.enabled).toBe(false);
    await request(app).post('/api/review/followup/outbox').expect(400);
    const availability = await request(app).get('/api/notifications/availability').expect(200);
    expect(availability.body.availableSeats).toBe(4); // private inventory not advertised
    expect(availability.body.message).toContain('Requests do not guarantee');
    const queued = await request(app).post('/api/notifications/availability').send({audience:'sales_team',message:availability.body.message}).expect(200);
    expect(queued.body.delivered).toBe(false);
    await request(app).put('/api/review/followup').send({enabled:true,subject:'Optional confirmation',body:'Please confirm attendance. Photo optional.'}).expect(200);
    await request(app).post('/api/review/followup/outbox').expect(200);
    expect((await request(app).get('/api/review/outbox')).body.messages).toHaveLength(2);
  });
  it('previews CSV deterministically without publishing, validates dates and imports only private inventory', async () => {
    const url = `/api/teams/${fixture.team.id}/schedule/import-csv`;
    const csv = 'date,time,opponent,promotions,tickets\n2026-11-20,19:00,Synthetic Visitors,,4';
    const preview = await request(app).post(url).send({csv,preview:true}).expect(200);
    expect(preview.body.published).toBe(false); expect(preview.body.games[0].gameDate).toBe('2026-11-20T19:00:00.000Z');
    expect(db.select().from(games).all()).toHaveLength(5);
    await request(app).post(url).send({csv}).expect(200);
    expect(db.select().from(games).all().filter((g)=>g.opponent==='Synthetic Visitors')[0].releaseStatus).toBe('private');
    await request(app).post(url).send({csv:'date,time,opponent,promotions,tickets\n2026-02-30,19:00,Invalid,,4',preview:true}).expect(400);
    const local = await request(app).post(`/api/teams/${fixture.team.id}/schedule/import`).send({pastedText:csv,preview:true}).expect(200);
    expect(local.body.provider).toBe('local-csv');
    const imported = await request(app).post(`/api/teams/${fixture.team.id}/schedule/import`).send({preview:false,games:[{gameDate:'2027-01-05T19:00:00Z',opponent:'Synthetic parsed opponent'}],ticketsPerGame:2}).expect(200);
    expect(imported.body.imported).toBe(1);
  });
  it('keeps scoring advisory, season-scoped and excludes unknown outcomes from reliability', async () => {
    const gameId = fixture.inventory[0].game.id;
    const ranking = scoreGame(gameId);
    const fairness = ranking.ranked[0].breakdown.find((f)=>f.factor==='fairness')!;
    expect(fairness.rawValue).toBe(1); // current season past demo only, previous season excluded
    expect(DEFAULT_SCORING_WEIGHTS.leadTime).toBe(0); expect(DEFAULT_SCORING_WEIGHTS.premiumDemandBalance).toBe(0); expect(DEFAULT_SCORING_WEIGHTS.employeeCustomerBalance).toBe(0);
    const before = db.select().from(assignments).all().length;
    await request(app).post(`/api/games/${gameId}/assignments/recommend`).send({approve:true}).expect(400);
    expect(db.select().from(assignments).all()).toHaveLength(before);
    await request(app).post(`/api/games/${gameId}/requests/score`).expect(200);
    expect(db.select().from(assignments).all()).toHaveLength(before);
  });
});


describe('date submission regression', () => {
  it('rejects malformed event instants without creating inventory', async () => {
    const before = db.select().from(games).all().length;
    for (const date of [':00Z', '', '0', '2026-12-20T18:00', '2026-02-30T18:00:00Z', '2025-02-29T18:00:00Z', '2026-12-20T24:00:00Z']) {
      await request(app).post('/api/events').send({title:'Synthetic invalid date regression',date,tickets:2}).expect(400);
    }
    expect(db.select().from(games).all()).toHaveLength(before);
    const valid = await request(app).post('/api/events').send({title:'Synthetic valid date regression',date:'2026-12-20T18:00:00Z',tickets:2}).expect(201);
    expect(valid.body.game.gameDate).toBe(1797789600000);
    expect(valid.body.seatsCreated).toBe(2);
    const offset = await request(app).post('/api/events').send({title:'Synthetic offset regression',date:'2026-12-20T18:00:00-08:00',tickets:2}).expect(201);
    expect(offset.body.game.gameDate).toBe(Date.parse('2026-12-21T02:00:00Z'));
  });
  it('applies actual-calendar validation to release and game entry/import paths', async () => {
    const game = fixture.inventory[0].game;
    await request(app).post('/api/review/releases').send({gameIds:[game.id],action:'schedule',releaseAt:'2027-02-30T18:00:00Z'}).expect(400);
    await request(app).patch(`/api/games/${game.id}`).send({gameDate:'2026-02-30'}).expect(400);
    await request(app).post(`/api/teams/${fixture.team.id}/games`).send({gameDate:':00Z',opponent:'Invalid synthetic opponent',tickets:2}).expect(400);
    await request(app).post(`/api/teams/${fixture.team.id}/schedule/import`).send({preview:false,games:[{gameDate:'2026-02-30T18:00:00Z',opponent:'Invalid synthetic schedule'}]}).expect(400);
    await request(app).post(`/api/seasons/${fixture.season.id}/games/import`).send({games:[{gameDate:'2026-02-30',opponent:'Invalid legacy calendar date'}]}).expect(400);
    expect(db.select().from(games).where(eq(games.id,game.id)).get()).toMatchObject({gameDate:game.gameDate,releaseStatus:'private',releaseAt:null});
    const dateOnly = await request(app).post('/api/games').send({seasonId:fixture.season.id,gameDate:'2026-12-20',opponent:'Legacy synthetic midnight UTC'}).expect(201);
    expect(dateOnly.body.game.gameDate).toBe(Date.parse('2026-12-20T00:00:00Z'));
  });
});
