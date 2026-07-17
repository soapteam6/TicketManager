import { Router, type Request, type Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import {
  createRequestSchema,
  updateRequestSchema,
  requestQuery,
  importRequestsSchema,
  idParam,
} from '@ais/shared';
import { db } from '../db/client.js';
import { ticketRequests, contacts, games, requestContacts } from '../db/schema.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { newPublicId } from '../lib/ids.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getEmailIntakeAdapter } from '../adapters/email/index.js';
import { logIntegration } from '../adapters/integration-log.js';
import { scoreGameWithNarrative } from './scoring-service.js';

export const requestsRouter = Router();
requestsRouter.use(requireAuth);

function withBeneficiary(rows: Array<{ req: typeof ticketRequests.$inferSelect; contact: typeof contacts.$inferSelect | null }>) {
  return rows.map(({ req, contact }) => ({
    ...req,
    scoringBreakdown: req.scoringBreakdown ? JSON.parse(req.scoringBreakdown) : null,
    beneficiaryName: contact?.fullName ?? req.requesterName ?? null,
    beneficiaryCompany: contact?.company ?? req.requesterCompany ?? null,
  }));
}

requestsRouter.get('/', validate(requestQuery, 'query'), (req: Request, res: Response) => {
  const q = req.query as unknown as { gameId?: number; status?: string; mine?: boolean };
  const conds = [];
  if (q.gameId) conds.push(eq(ticketRequests.gameId, q.gameId));
  if (q.status) conds.push(eq(ticketRequests.status, q.status));
  if (q.mine) conds.push(eq(ticketRequests.requesterUserId, req.user!.id));
  const rows = db
    .select({ req: ticketRequests, contact: contacts })
    .from(ticketRequests)
    .leftJoin(contacts, eq(ticketRequests.beneficiaryContactId, contacts.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(ticketRequests.createdAt))
    .all();
  res.json({ requests: withBeneficiary(rows) });
});

requestsRouter.get('/:id', validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const row = db
    .select({ req: ticketRequests, contact: contacts })
    .from(ticketRequests)
    .leftJoin(contacts, eq(ticketRequests.beneficiaryContactId, contacts.id))
    .where(eq(ticketRequests.id, id))
    .get();
  if (!row) throw notFound('Request not found');
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

function createRequestRow(input: ReturnType<typeof createRequestSchema.parse>, userId: number | null, source: 'manual' | 'email_intake') {
  const game = db.select().from(games).where(eq(games.id, input.gameId)).get();
  if (!game) throw notFound('Game not found');

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
  const primaryContactId = uniqueContactIds[0] ?? null;

  // Snapshot for display: first contact name (+N others) and the account company.
  const first = input.beneficiaryContacts?.[0];
  const extra = input.beneficiaryContacts && input.beneficiaryContacts.length > 1 ? ` +${input.beneficiaryContacts.length - 1}` : '';
  const requesterName = first ? `${first.fullName}${extra}` : input.requesterName || null;
  const requesterCompany = input.requesterCompany || first?.company || null;
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
  const created = createRequestRow(req.body, req.user!.id, 'manual');
  res.status(201).json({ request: created });
});

requestsRouter.patch('/:id', validate(idParam, 'params'), validate(updateRequestSchema), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const existing = db.select().from(ticketRequests).where(eq(ticketRequests.id, id)).get();
  if (!existing) throw notFound('Request not found');
  const input = req.body;
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

requestsRouter.post('/:id/cancel', validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const existing = db.select().from(ticketRequests).where(eq(ticketRequests.id, id)).get();
  if (!existing) throw notFound('Request not found');
  db.update(ticketRequests).set({ status: 'cancelled', updatedAt: Date.now() }).where(eq(ticketRequests.id, id)).run();
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
          notes: p.notes,
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
gameRequestsRouter.use(requireAuth);

gameRequestsRouter.post('/score', async (req: Request, res: Response) => {
  const gameId = Number((req.params as Record<string, string>).gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) throw badRequest('Invalid game id');
  const { ranking, narrative } = await scoreGameWithNarrative(gameId);
  res.json({ ranking, narrative });
});
