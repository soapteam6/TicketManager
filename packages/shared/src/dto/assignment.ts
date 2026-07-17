import { z } from 'zod';

export const createAssignmentSchema = z.object({
  requestId: z.coerce.number().int().positive(),
  seatId: z.coerce.number().int().positive(),
});
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

export const reassignSchema = z.object({
  toSeatId: z.coerce.number().int().positive(),
});
export type ReassignInput = z.infer<typeof reassignSchema>;

// Auto-recommend + create proposed assignments for the top-ranked requests of a game.
export const recommendSchema = z.object({
  approve: z.boolean().optional(), // if true, create as 'approved' rather than 'proposed'
});
export type RecommendInput = z.infer<typeof recommendSchema>;

export const addWaitlistSchema = z.object({
  requestId: z.coerce.number().int().positive(),
});
export type AddWaitlistInput = z.infer<typeof addWaitlistSchema>;
