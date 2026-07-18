import { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { createAssignmentSchema, reassignSchema, recommendSchema, recordAttendanceSchema, transferSchema, idParam } from '@ais/shared';
import { db } from '../db/client.js';
import { assignments, seats, ticketRequests, contacts, attendanceRecords } from '../db/schema.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { badRequest } from '../lib/errors.js';
import {
  assignSeat,
  approveAssignment,
  declineAssignment,
  reassign,
  recommendForGame,
  seatLabel,
} from './assignments-service.js';
import { transferAssignment, transferGame } from './transfer-service.js';
import { recordAttendance } from './attendance-service.js';

export const assignmentsRouter = Router();
assignmentsRouter.use(requireAuth);

assignmentsRouter.get('/', (req: Request, res: Response) => {
  const gameId = req.query.gameId ? Number(req.query.gameId) : undefined;
  const status = req.query.status as string | undefined;
  const conds = [];
  if (gameId) conds.push(eq(assignments.gameId, gameId));
  if (status) conds.push(eq(assignments.status, status));
  const rows = db
    .select({ a: assignments, seat: seats, req: ticketRequests, contact: contacts, att: attendanceRecords })
    .from(assignments)
    .leftJoin(seats, eq(assignments.seatId, seats.id))
    .leftJoin(ticketRequests, eq(assignments.requestId, ticketRequests.id))
    .leftJoin(contacts, eq(assignments.beneficiaryContactId, contacts.id))
    .leftJoin(attendanceRecords, eq(attendanceRecords.assignmentId, assignments.id))
    .where(conds.length ? and(...conds) : undefined)
    .all();
  res.json({
    assignments: rows.map(({ a, seat, req, contact, att }) => ({
      ...a,
      seatLabel: seat ? seatLabel(seat) : null,
      ticketType: seat?.ticketType ?? null,
      requesterName: contact?.fullName ?? req?.requesterName ?? null,
      quantity: req?.quantity ?? null,
      attendanceStatus: att?.ticketStatus ?? null,
    })),
  });
});

assignmentsRouter.post('/', requireRole('admin'), validate(createAssignmentSchema), (req: Request, res: Response) => {
  const { requestId, seatId } = req.body;
  const created = assignSeat({ requestId, seatId, status: 'approved', userId: req.user!.id });
  res.status(201).json({ assignment: created });
});

assignmentsRouter.post('/:id/approve', requireRole('admin'), validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  res.json({ assignment: approveAssignment(id, req.user!.id) });
});

assignmentsRouter.post('/:id/decline', requireRole('admin'), validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  declineAssignment(id);
  res.json({ ok: true });
});

assignmentsRouter.post('/:id/reassign', requireRole('admin'), validate(idParam, 'params'), validate(reassignSchema), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  res.json({ assignment: reassign(id, req.body.toSeatId, req.user!.id) });
});

assignmentsRouter.post('/:id/transfer', requireRole('admin'), validate(idParam, 'params'), async (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const result = await transferAssignment(id);
  res.json(result);
});

assignmentsRouter.post(
  '/:id/attendance',
  requireRole('admin', 'sales_rep'),
  validate(idParam, 'params'),
  validate(recordAttendanceSchema),
  (req: Request, res: Response) => {
    const { id } = req.params as unknown as { id: number };
    res.json({ attendance: recordAttendance(id, req.body, req.user!.id) });
  }
);

// --- Game-scoped: GET/POST /games/:gameId/assignments ---
export const gameAssignmentsRouter = Router({ mergeParams: true });
gameAssignmentsRouter.use(requireAuth);

gameAssignmentsRouter.get('/', (req: Request, res: Response) => {
  const gameId = Number((req.params as Record<string, string>).gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) throw badRequest('Invalid game id');
  const rows = db
    .select({ a: assignments, seat: seats, req: ticketRequests, contact: contacts, att: attendanceRecords })
    .from(assignments)
    .leftJoin(seats, eq(assignments.seatId, seats.id))
    .leftJoin(ticketRequests, eq(assignments.requestId, ticketRequests.id))
    .leftJoin(contacts, eq(assignments.beneficiaryContactId, contacts.id))
    .leftJoin(attendanceRecords, eq(attendanceRecords.assignmentId, assignments.id))
    .where(eq(assignments.gameId, gameId))
    .all();
  res.json({
    assignments: rows.map(({ a, seat, req, contact, att }) => ({
      ...a,
      seatLabel: seat ? seatLabel(seat) : null,
      ticketType: seat?.ticketType ?? null,
      requesterName: contact?.fullName ?? req?.requesterName ?? null,
      quantity: req?.quantity ?? null,
      attendanceStatus: att?.ticketStatus ?? null,
    })),
  });
});

gameAssignmentsRouter.post('/recommend', requireRole('admin'), validate(recommendSchema), (req: Request, res: Response) => {
  const gameId = Number((req.params as Record<string, string>).gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) throw badRequest('Invalid game id');
  res.json(recommendForGame(gameId, Boolean(req.body.approve), req.user!.id));
});

// --- Game-scoped: POST /games/:gameId/transfer ---
export const gameTransferRouter = Router({ mergeParams: true });
gameTransferRouter.use(requireAuth, requireRole('admin'));

gameTransferRouter.post('/', validate(transferSchema), async (req: Request, res: Response) => {
  const gameId = Number((req.params as Record<string, string>).gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) throw badRequest('Invalid game id');
  const result = await transferGame(gameId, req.body.assignmentIds);
  res.json(result);
});
