import { Router, type Request, type Response } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  createRequestSchema,
  updateRequestSchema,
  requestQuery,
  importRequestsSchema,
  idParam,
  ACTIVE_ASSIGNMENT_STATUSES,
} from '@ais/shared';
import { db } from '../db/client.js';
import { ticketRequests, contacts, games, requestContacts, assignments, users } from '../db/schema.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { newPublicId } from '../lib/ids.js';
import { badRequest, notFound, forbidden, conflict } from '../lib/errors.js';
import { getEmailIntakeAdapter } from '../adapters/email/index.js';
import { logIntegration } from '../adapters/integration-log.js';
import { isReleased } from './release-service.js';
import { scoreGameWithNarrative } from './scoring-service.js';

export const requestsRouter = Router();
requestsRouter.use(requireAuth);

function withBeneficiary(
  rows: Array<{
    req: typeof ticketRequests.$inferSelect;
    contact: typeof contacts.$inferSelect | null;
    game?: typeof games.$inferSelect | null;
  }>
) {
  const linked = rows.length ? db.select({ requestId: requestContacts.requestId, contact: contacts }).from(requestContacts).innerJoin(contacts, eq(requestContacts.contactId, contacts.id)).where(inArray(requestContacts.requestId, rows.map((r) => r.req.id))).all() : [];
  return rows.map(({ req, contact, game }) => ({
    beneficiaries: linked.filter((l) => l.requestId === req.id).map((l) => ({ id:l.contact.id, fullName:l.contact.fullName, phone:l.contact.phone, email:l.contact.email, noShowCount:l.contact.noShowCount })),
    ...req,
    scoringBreakdown: req.scoringBreakdown ? JSON.parse(req.scoringBreakdown) : null,
    beneficiaryName: contact?.fullName ?? req.requesterName ?? null,
    beneficiaryCompany: contact?.company ?? req.requesterCompany ?? null,
    beneficiaryNoShowCount: Math.max(contact?.noShowCount ?? 0, linked.filter((l) => l.requestId === req.id).reduce((n,l) => n+l.contact.noShowCount,0)),
    opponent: game?.opponent ?? null,
    gameTitle: game?.title ?? null,
    gameKind: game?.kind ?? null,
    gameDate: game?.gameDate ?? null,
  }));
}

requestsRouter.get('/', validate(requestQuery, 'query'), (req: Request, res: Response) => {
  const q = req.query as unknown as { gameId?: number; status?: string; mine?: boolean };
  const conds = [];
  if (q.gameId) conds.push(eq(ticketRequests.gameId, q.gameId));
  if (q.status) conds.push(eq(ticketRequests.status, q.status));
  if (q.mine || req.user!.role !== 'admin') conds.push(eq(ticketRequests.requesterUserId, req.user!.id));
  const rows = db
    .select({ req: ticketRequests, contact: contacts, game: games })
    .from(ticketRequests)
    .leftJoin(contacts, eq(ticketRequests.beneficiaryContactId, contacts.id))
    .leftJoin(games, eq(ticketRequests.gameId, games.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(ticketRequests.createdAt))
    .all();
  res.json({ requests: withBeneficiary(rows).map((r) => req.user!.role === 'admin' ? r : publicRequest(r)) });
});

requestsRouter.get('/:id', validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const row = db
    .select({ req: ticketRequests, contact: contacts })
    .from(ticketRequests)
    .leftJoin(contacts, eq(ticketRequests.beneficiaryContactId, contacts.id))
    .where(eq(ticketRequests.id, id))
    .get();
  if (!row || req.user!.role !== 'admin' && row.req.requesterUserId !== req.user!.id) throw notFound('Request not found');
  if (req.user!.role !== 'admin') { res.json({ request: publicRequest(row.req) }); return; }
  // All linked beneficiary contacts (a request can have several from the same company).
  const beneficiaries = db
    .select({ id: contacts.id, fullName: contacts.fullName, company: contacts.company, email: contacts.email, title: contacts.title })
    .from(requestContacts)
    .innerJoin(contacts, eq(requestContacts.contactId, contacts.id))
    .where(eq(requestContacts.requestId, id))
    .all();
  res.json({ request: { ...withBeneficiary([row])[0], beneficiaries } });
});

interface ContactPick {
  localContactId?: number;
  crmContactId?: string;
  crmAccountId?: string;
  directoryUserId?: string;
  fullName: string;
  company?: string;
  email?: string;
  phone?: string;
  title?: string;
}

// Find-or-create a local contact from a single pick — a CRM contact (customer) or an Entra
// directory user (employee) — so the request still participates in scoring/history.
// Matched by CRM id, then directory id, then email.
function upsertContactFromPick(pick: ContactPick, beneficiaryType: 'customer' | 'employee', userId: number | null): number {
  if (pick.localContactId) return pick.localContactId;
  if (pick.crmContactId) {
    const byCrm = db.select().from(contacts).where(eq(contacts.crmContactId, pick.crmContactId)).get();
    if (byCrm) return byCrm.id;
  }
  if (pick.directoryUserId) {
    const byDir = db.select().from(contacts).where(eq(contacts.directoryUserId, pick.directoryUserId)).get();
    if (byDir) return byDir.id;
  }
  if (pick.email) {
    const byEmail = db.select().from(contacts).where(eq(contacts.email, pick.email)).get();
    if (byEmail) return byEmail.id;
  }
  const now = Date.now();
  return db
    .insert(contacts)
    .values({
      publicId: newPublicId(),
      type: beneficiaryType,
      fullName: pick.fullName || pick.company || 'Contact',
      company: pick.company || null,
      email: pick.email || null,
      phone: pick.phone || null,
      title: pick.title || null,
      valueTier: 'prospect',
      crmContactId: pick.crmContactId || null,
      crmAccountId: pick.crmAccountId || null,
      directoryUserId: pick.directoryUserId || null,
      accountOwnerUserId: userId && userId > 0 ? userId : null,
      futurePriorityFlag: 'normal',
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get().id;
}

export function createRequestRow(input: ReturnType<typeof createRequestSchema.parse>, userId: number | null, source: 'manual' | 'email_intake') {
  const game = db.select().from(games).where(eq(games.id, input.gameId)).get();
  if (!game) throw notFound('Game not found');
  if (['cancelled', 'completed'].includes(game.status)) throw conflict('This event no longer accepts interest');

  // Resolve one or more beneficiary contacts (all from the same company in the CRM flow).
  const contactIds: number[] = [];
  if (input.beneficiaryContacts && input.beneficiaryContacts.length > 0) {
    for (const pick of input.beneficiaryContacts) {
      contactIds.push(upsertContactFromPick({ ...pick, email: pick.email || undefined }, input.beneficiaryType, userId));
    }
  } else if (input.crmContactId || input.crmAccountId) {
    contactIds.push(
      upsertContactFromPick(
        {
          crmContactId: input.crmContactId,
          crmAccountId: input.crmAccountId,
          fullName: input.requesterName || input.requesterCompany || 'CRM Contact',
          company: input.requesterCompany,
          email: input.requesterEmail || undefined,
          phone: input.requesterPhone,
        },
        input.beneficiaryType,
        userId
      )
    );
  } else if (input.beneficiaryContactId) {
    contactIds.push(input.beneficiaryContactId);
  }
  const uniqueContactIds = [...new Set(contactIds)];
  for (const cid of uniqueContactIds) {
    const c = db.select().from(contacts).where(eq(contacts.id, cid)).get();
    if (!c || !c.isActive || !c.directoryActive) throw badRequest('Select active contacts; history for inactive people remains available to coordinators');
    if (c.type !== input.beneficiaryType) throw badRequest('Contact purpose does not match customer/employee selection');
  }
  const selectedContacts = uniqueContactIds.map((cid) => db.select().from(contacts).where(eq(contacts.id, cid)).get()!);
  if (input.beneficiaryType === 'customer' && new Set(selectedContacts.map((c) => c.company ?? c.crmAccountId)).size > 1) throw badRequest('Select contacts from one customer');
  if (uniqueContactIds.length > input.quantity) throw badRequest('Selected contacts exceed requested tickets');
  const primaryContactId = uniqueContactIds[0] ?? null;

  // Snapshot for display: first contact name (+N others) and the account company.
  const first = selectedContacts[0] ?? input.beneficiaryContacts?.[0];
  const extra = input.beneficiaryContacts && input.beneficiaryContacts.length > 1 ? ` +${input.beneficiaryContacts.length - 1}` : '';
  const requesterName = first ? `${first.fullName}${extra}` : input.requesterName || null;
  const requesterCompany = first?.company || input.requesterCompany || null;
  const requesterEmail = first?.email || input.requesterEmail || null;
  const requesterPhone = first?.phone || input.requesterPhone || null;

  const now = Date.now();
  const request = db
    .insert(ticketRequests)
    .values({
      publicId: newPublicId(),
      gameId: input.gameId,
      requesterUserId: userId,
      requesterName,
      requesterCompany,
      requesterPhone,
      requesterEmail,
      beneficiaryContactId: primaryContactId,
      beneficiaryType: input.beneficiaryType,
      quantity: input.quantity,
      notes: input.notes ?? null,
      salesOpportunityUsd: input.salesOpportunityUsd ?? 0,
      status: 'submitted',
      source,
      crmOpportunityId: input.crmOpportunityId || null,
      crmOpportunityName: input.crmOpportunityName || null,
      accountOwner: input.accountOwner || null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  for (const cid of uniqueContactIds) {
    db.insert(requestContacts).values({ requestId: request.id, contactId: cid, createdAt: now }).run();
  }
  return { ...request, beneficiaryContactIds: uniqueContactIds };
}

requestsRouter.post('/', validate(createRequestSchema), (req: Request, res: Response) => {
  const game = db.select().from(games).where(eq(games.id, req.body.gameId)).get();
  if (!game || req.user!.role !== 'admin' && !isReleased(game)) throw notFound('Released inventory not found');
  if (req.user!.role !== 'admin' && !req.body.beneficiaryContactId) throw badRequest('Select a local active contact');
  if (req.user!.role !== 'admin' && (req.body.crmContactId || req.body.crmAccountId)) throw forbidden('Select existing local contacts');
  if (req.user!.role !== 'admin' && req.body.beneficiaryContacts?.some((c: ContactPick) => !c.localContactId)) throw forbidden('Use existing local contacts in requester mode');
  const actor = db.select().from(contacts).where(eq(contacts.email, req.user!.email)).get();
  if (req.user!.role !== 'admin' && actor && (!actor.isActive || !actor.directoryActive)) throw badRequest('Your app/directory entry is inactive; a coordinator can review history');
  if (req.user!.role !== 'admin' && game.gameDate <= Date.now()) throw conflict('This event no longer accepts new interest');
  if (req.user!.role === 'employee' || req.user!.role !== 'admin' && req.body.beneficiaryType === 'employee') {
    const self = db.select().from(contacts).where(eq(contacts.email, req.user!.email)).get();
    if (req.body.beneficiaryType !== 'employee' || req.body.beneficiaryContactId !== self?.id || req.body.beneficiaryContacts?.some((c: ContactPick) => c.localContactId !== self?.id)) throw forbidden('Employee demo persona can express interest for self only');
  }
  let requesterId = req.user!.id;
  if (req.body.onBehalfUserId !== undefined) {
    if (req.user!.role !== 'admin') throw forbidden('Only coordinators can record interest on behalf of others');
    const person = db.select().from(users).where(eq(users.id, req.body.onBehalfUserId)).get();
    if (!person || !person.isActive) throw badRequest('Select an active requesting person');
    const personContact = db.select().from(contacts).where(eq(contacts.email, person.email)).get();
    if (personContact && (!personContact.isActive || !personContact.directoryActive)) throw badRequest('Requesting person is inactive in the app or source');
    requesterId = person.id;
  }
  const created = db.transaction(() => createRequestRow(req.body, requesterId, 'manual'));
  res.status(201).json({ request: req.user!.role === 'admin' ? created : publicRequest(created), interestOnly: true });
});

requestsRouter.patch('/:id', validate(idParam, 'params'), validate(updateRequestSchema), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const existing = db.select().from(ticketRequests).where(eq(ticketRequests.id, id)).get();
  if (!existing) throw notFound('Request not found');
  const input = req.body;
  const active = db.select().from(assignments).where(and(eq(assignments.requestId, id), inArray(assignments.status, ACTIVE_ASSIGNMENT_STATUSES))).all().length;
  if (input.quantity !== undefined && input.quantity < active) throw conflict('Requested quantity cannot be lower than active allocations');
  if (active && input.beneficiaryContactId !== undefined && input.beneficiaryContactId !== existing.beneficiaryContactId) throw conflict('Preserve the beneficiary while allocations are active');
  const updated = db
    .update(ticketRequests)
    .set({
      quantity: input.quantity ?? existing.quantity,
      notes: input.notes ?? existing.notes,
      salesOpportunityUsd: input.salesOpportunityUsd ?? existing.salesOpportunityUsd,
      beneficiaryContactId: input.beneficiaryContactId === undefined ? existing.beneficiaryContactId : input.beneficiaryContactId,
      updatedAt: Date.now(),
    })
    .where(eq(ticketRequests.id, id))
    .returning()
    .get();
  res.json({ request: updated });
});

// Retire interest without deleting allocation or attendance history.
requestsRouter.delete('/:id', requireRole('admin'), validate(idParam, 'params'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  cancelRequest(id);
  res.json({ ok: true });
});
function cancelRequest(id: number) {
  const active = db.select().from(assignments).where(and(eq(assignments.requestId, id), inArray(assignments.status, ACTIVE_ASSIGNMENT_STATUSES))).all();
  if (active.length) throw conflict('Cancel active assignments individually before retiring this request');
  if (!db.select().from(ticketRequests).where(eq(ticketRequests.id, id)).get()) throw notFound('Request not found');
  db.update(ticketRequests).set({ status: 'cancelled', updatedAt: Date.now() }).where(eq(ticketRequests.id, id)).run();
}

requestsRouter.post('/:id/cancel', validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const existing = db.select().from(ticketRequests).where(eq(ticketRequests.id, id)).get();
  if (!existing) throw notFound('Request not found');
  cancelRequest(id);
  res.json({ ok: true });
});

// Email-intake simulation: parse pasted text into structured requests.
requestsRouter.post('/import', validate(importRequestsSchema), (req: Request, res: Response) => {
  const { gameId, rawText } = req.body as { gameId?: number; rawText: string };
  const adapter = getEmailIntakeAdapter();
  const messages = adapter.splitMessages(rawText);
  const parsed = messages.map((m) => adapter.parse(m));

  let created = 0;
  const results = parsed.map((p) => {
    let requestId: number | null = null;
    if (gameId && !p.needsReview) {
      const row = createRequestRow(
        {
          gameId,
          beneficiaryContactId: null,
          beneficiaryType: p.beneficiaryType,
          quantity: p.quantity,
          notes: p.notes || 'Imported request; coordinator must review business context.',
          salesOpportunityUsd: p.salesOpportunityUsd,
          requesterName: p.requesterName,
          requesterCompany: p.requesterCompany,
          requesterPhone: p.requesterPhone,
          requesterEmail: p.requesterEmail,
        },
        req.user!.id,
        'email_intake'
      );
      requestId = row.id;
      created++;
    }
    return { ...p, requestId };
  });

  logIntegration({
    adapter: 'email_intake',
    operation: 'import',
    status: 'success',
    payload: { messages: messages.length, gameId },
    response: { created, needsReview: parsed.filter((p) => p.needsReview).length },
  });

  res.json({ parsed: results, created });
});

// --- Game-scoped scoring route: POST /games/:gameId/requests/score ---
export const gameRequestsRouter = Router({ mergeParams: true });
gameRequestsRouter.use(requireAuth, requireRole('admin'));

gameRequestsRouter.post('/score', async (req: Request, res: Response) => {
  const gameId = Number((req.params as Record<string, string>).gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) throw badRequest('Invalid game id');
  const { ranking, narrative } = await scoreGameWithNarrative(gameId);
  res.json({ ranking, narrative });
});

function publicRequest(r: typeof ticketRequests.$inferSelect) {
  return { id: r.id, gameId: r.gameId, quantity: r.quantity, beneficiaryType: r.beneficiaryType,
    requesterName: r.requesterName, requesterCompany: r.requesterCompany, notes: r.notes, status: r.status, createdAt: r.createdAt };
}
