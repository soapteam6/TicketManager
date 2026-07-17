import { z } from 'zod';
import { CONTACT_TYPE, VALUE_TIER, FUTURE_PRIORITY } from '../enums.js';

export const createContactSchema = z.object({
  type: z.enum(CONTACT_TYPE),
  fullName: z.string().min(1),
  company: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  title: z.string().optional(),
  accountOwnerUserId: z.coerce.number().int().positive().optional().nullable(),
  valueTier: z.enum(VALUE_TIER).optional(),
  notes: z.string().optional(),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = createContactSchema.partial().extend({
  futurePriorityFlag: z.enum(FUTURE_PRIORITY).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const contactQuery = z.object({
  type: z.enum(CONTACT_TYPE).optional(),
  ownerId: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
});
