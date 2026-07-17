import { Router, type Request, type Response } from 'express';
import { and, desc, eq, like } from 'drizzle-orm';
import { createContactSchema, updateContactSchema, contactQuery, idParam } from '@ais/shared';
import { db } from '../db/client.js';
import { contacts, attendanceRecords, ticketRequests, games } from '../db/schema.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { newPublicId } from '../lib/ids.js';
import { notFound } from '../lib/errors.js';

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

contactsRouter.get('/', validate(contactQuery, 'query'), (req: Request, res: Response) => {
  const { type, ownerId, q } = req.query as unknown as { type?: string; ownerId?: number; q?: string };
  const filters = [];
  if (type) filters.push(eq(contacts.type, type));
  if (ownerId) filters.push(eq(contacts.accountOwnerUserId, ownerId));
  if (q) filters.push(like(contacts.fullName, `%${q}%`));
  const where = filters.length ? and(...filters) : undefined;
  const rows = db.select().from(contacts).where(where).all();
  res.json({ contacts: rows });
});

contactsRouter.get('/:id', validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const contact = db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!contact) throw notFound('Contact not found');
  res.json({ contact });
});

contactsRouter.get('/:id/history', validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const contact = db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!contact) throw notFound('Contact not found');
  const attendance = db
    .select({
      record: attendanceRecords,
      opponent: games.opponent,
      gameDate: games.gameDate,
    })
    .from(attendanceRecords)
    .leftJoin(games, eq(attendanceRecords.gameId, games.id))
    .where(eq(attendanceRecords.contactId, id))
    .orderBy(desc(games.gameDate))
    .all();
  const requests = db
    .select()
    .from(ticketRequests)
    .where(eq(ticketRequests.beneficiaryContactId, id))
    .orderBy(desc(ticketRequests.createdAt))
    .all();
  res.json({ contact, attendance, requests });
});

contactsRouter.post('/', requireRole('admin', 'sales_rep'), validate(createContactSchema), (req: Request, res: Response) => {
  const input = req.body;
  const now = Date.now();
  const contact = db
    .insert(contacts)
    .values({
      publicId: newPublicId(),
      type: input.type,
      fullName: input.fullName,
      company: input.company ?? null,
      email: input.email ? input.email : null,
      phone: input.phone ?? null,
      title: input.title ?? null,
      accountOwnerUserId: input.accountOwnerUserId ?? null,
      valueTier: input.valueTier ?? 'prospect',
      lifetimeBusinessGenerated: 0,
      lastTicketDate: null,
      noShowCount: 0,
      attendedCount: 0,
      awardedCount: 0,
      futurePriorityFlag: 'normal',
      notes: input.notes ?? null,
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  res.status(201).json({ contact });
});

contactsRouter.patch(
  '/:id',
  requireRole('admin', 'sales_rep'),
  validate(idParam, 'params'),
  validate(updateContactSchema),
  (req: Request, res: Response) => {
    const { id } = req.params as unknown as { id: number };
    const existing = db.select().from(contacts).where(eq(contacts.id, id)).get();
    if (!existing) throw notFound('Contact not found');
    const input = req.body;
    const contact = db
      .update(contacts)
      .set({
        type: input.type ?? existing.type,
        fullName: input.fullName ?? existing.fullName,
        company: input.company === undefined ? existing.company : input.company,
        email: input.email === undefined ? existing.email : input.email ? input.email : null,
        phone: input.phone === undefined ? existing.phone : input.phone,
        title: input.title === undefined ? existing.title : input.title,
        accountOwnerUserId: input.accountOwnerUserId === undefined ? existing.accountOwnerUserId : input.accountOwnerUserId,
        valueTier: input.valueTier ?? existing.valueTier,
        futurePriorityFlag: input.futurePriorityFlag ?? existing.futurePriorityFlag,
        notes: input.notes === undefined ? existing.notes : input.notes,
        isActive: input.isActive === undefined ? existing.isActive : input.isActive ? 1 : 0,
        updatedAt: Date.now(),
      })
      .where(eq(contacts.id, id))
      .returning()
      .get();
    res.json({ contact });
  }
);
