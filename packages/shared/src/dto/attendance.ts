import { z } from 'zod';
import { TICKET_STATUS, CONTACT_TYPE, FUTURE_PRIORITY } from '../enums.js';

export const recordAttendanceSchema = z.object({
  ticketStatus: z.enum(TICKET_STATUS),
  // Designation and the scoring fields are optional in the simplified reconcile flow;
  // the service defaults designation to the beneficiary's type (falling back to 'customer').
  designation: z.enum(CONTACT_TYPE).optional(),
  salesRepUserId: z.coerce.number().int().positive().optional().nullable(),
  businessGenerated: z.coerce.number().min(0).optional(),
  followUpNotes: z.string().optional(),
  futurePriority: z.enum(FUTURE_PRIORITY).optional(),
});
export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>;

export const transferSchema = z.object({
  // Optional subset of assignment ids; omitted = transfer all approved for the game.
  assignmentIds: z.array(z.coerce.number().int().positive()).optional(),
});
export type TransferInput = z.infer<typeof transferSchema>;
