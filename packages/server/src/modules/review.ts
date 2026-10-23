import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { releaseInventorySchema, MOCK_PERSONAS, type FollowupTemplate } from '@ais/shared';
import { db, sqlite } from '../db/client.js';
import { contacts, seats, ticketRequests, assignments, users } from '../db/schema.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { releaseInventory } from './release-service.js';
import { assignSeat } from './assignments-service.js';

export const reviewRouter = Router();
reviewRouter.get('/session', (req, res) => {
  const persona = Object.values(MOCK_PERSONAS).find((p) => p.email === req.user!.email)!;
  res.json({ user: { ...req.user, fullName: persona.fullName }, mockOnly: true });
});
reviewRouter.get('/request-options', (req, res) => {
  const rows = db.select().from(contacts).where(and(eq(contacts.isActive, 1), eq(contacts.directoryActive, 1))).all();
  const eligible = db.select().from(users).all().filter((u) => u.isActive && !db.select().from(contacts).all().some((c) => c.email === u.email && (!c.isActive || !c.directoryActive)));
  res.json({ requesterUsers: req.user!.role === 'admin' ? eligible.map((u) => ({ id: u.id, fullName: u.fullName })) : undefined, contacts: rows.filter((c) => req.user!.role === 'admin' || c.type === 'customer' && req.user!.role === 'sales_rep' || c.email === req.user!.email)
    .map((c) => ({ id: c.id, type: c.type, fullName: c.fullName, company: c.company, email: c.email, phone: c.phone })) });
});
reviewRouter.post('/review/releases', requireRole('admin'), validate(releaseInventorySchema), (req, res) => {
  res.json(releaseInventory(req.body));
});
const allocationSchema = z.object({ requestId: z.number().int().positive(), quantity: z.number().int().min(1).max(100), reason: z.string().trim().min(1).max(1000) });
reviewRouter.post('/review/allocate', requireRole('admin'), validate(allocationSchema), (req, res) => {
  const { requestId, quantity, reason } = req.body as z.infer<typeof allocationSchema>;
  const allocated = db.transaction(() => {
    const interest = db.select().from(ticketRequests).where(eq(ticketRequests.id, requestId)).get();
    if (!interest) throw notFound('Request not found');
    const pool = db.select().from(seats).where(and(eq(seats.gameId, interest.gameId), eq(seats.status, 'available'))).all();
    if (pool.length < quantity) throw conflict('Not enough available tickets; choose a smaller quantity or waitlist');
    const rows = pool.slice(0, quantity).map((seat) => assignSeat({ requestId, seatId: seat.id, status: 'approved', userId: req.user!.id }));
    sqlite.prepare('INSERT INTO allocation_decisions (request_id,user_id,reason,created_at) VALUES (?,?,?,?)').run(requestId, req.user!.id, reason, Date.now());
    return rows;
  }, { behavior: 'immediate' });
  res.status(201).json({ assignments: allocated, decisionRecorded: true });
});
const manualTransferSchema = z.object({ assignmentId: z.number().int().positive(), confirmed: z.literal(true), reference: z.string().trim().min(1).max(200) });
reviewRouter.post('/review/manual-transfer', requireRole('admin'), validate(manualTransferSchema), (req, res) => {
  const input = req.body as z.infer<typeof manualTransferSchema>;
  const row = db.transaction(() => {
    const a = db.select().from(assignments).where(eq(assignments.id, input.assignmentId)).get();
    if (!a) throw notFound('Assignment not found');
    if (a.status === 'transferred') return a;
    if (a.status !== 'approved') throw conflict('Only approved tickets can have a manual transfer recorded');
    const updated = db.update(assignments).set({ status: 'transferred', transferPlatform: 'manual', transferRef: input.reference, transferredAt: Date.now(), updatedAt: Date.now() }).where(eq(assignments.id, a.id)).returning().get();
    db.update(seats).set({ status: 'transferred' }).where(eq(seats.id, a.seatId)).run();
    return updated;
  });
  res.json({ assignment: row, providerContacted: false, message: 'Local record only. Ticket delivery occurs separately in the provider app.' });
});

export const DEFAULT_FOLLOWUP: FollowupTemplate = {
  enabled: false,
  subject: 'How was the event?',
  body: 'Please confirm whether you attended. A photo is optional; no photo is required. No reply leaves attendance unknown.',
};
function readFollowup(): FollowupTemplate {
  const row = sqlite.prepare("SELECT value FROM review_settings WHERE key='followup'").get() as { value: string } | undefined;
  return row ? JSON.parse(row.value) as FollowupTemplate : { ...DEFAULT_FOLLOWUP };
}
const templateSchema = z.object({ enabled: z.boolean(), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(2000) });
reviewRouter.get('/review/followup', requireRole('admin'), (_req, res) => res.json({ template: readFollowup(), mockOnly: true, automatic: false }));
reviewRouter.put('/review/followup', requireRole('admin'), validate(templateSchema), (req, res) => {
  sqlite.prepare("INSERT INTO review_settings(key,value) VALUES ('followup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(req.body));
  res.json({ template: req.body });
});
reviewRouter.post('/review/followup/preview', requireRole('admin'), validate(templateSchema), (req, res) => res.json({ preview: req.body, delivered: false }));
reviewRouter.post('/review/followup/outbox', requireRole('admin'), (req, res) => {
  const template = readFollowup();
  if (!template.enabled) throw badRequest('Optional follow-up is disabled. Enable the local template before creating a mock item.');
  // Explicit local simulation only. No recipient lookup, email call, timer, or photo upload.
  addMockOutbox('followup', template.subject, template.body, 'Synthetic preview audience');
  res.json({ queuedLocally: true, delivered: false });
});
reviewRouter.get('/review/outbox', requireRole('admin'), (_req, res) => {
  res.json({ messages: sqlite.prepare('SELECT * FROM mock_outbox ORDER BY id DESC').all(), delivered: false });
});
export function addMockOutbox(kind: 'availability' | 'followup', subject: string, body: string, audience: string) {
  sqlite.prepare('INSERT INTO mock_outbox(kind,subject,body,audience,created_at) VALUES (?,?,?,?,?)').run(kind, subject, body, audience, Date.now());
}
