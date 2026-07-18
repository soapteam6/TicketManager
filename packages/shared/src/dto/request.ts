import { z } from 'zod';
import { CONTACT_TYPE, REQUEST_STATUS } from '../enums.js';

// One selected beneficiary — a CRM contact (customer) or an Entra directory user (employee).
export const crmContactPickSchema = z.object({
  crmContactId: z.string().optional(),
  crmAccountId: z.string().optional(),
  directoryUserId: z.string().optional(),
  fullName: z.string().min(1),
  company: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  title: z.string().optional(),
});
export type CrmContactPick = z.infer<typeof crmContactPickSchema>;

export const createRequestSchema = z.object({
  gameId: z.coerce.number().int().positive(),
  beneficiaryContactId: z.coerce.number().int().positive().optional().nullable(),
  beneficiaryType: z.enum(CONTACT_TYPE),
  quantity: z.coerce.number().int().positive(),
  notes: z.string().optional(),
  salesOpportunityUsd: z.coerce.number().min(0).optional(),
  // Snapshot fields (used when the requester is not yet a system user, e.g. email intake).
  requesterName: z.string().optional(),
  requesterCompany: z.string().optional(),
  requesterPhone: z.string().optional(),
  requesterEmail: z.string().email().optional().or(z.literal('')),
  // Dynamics 365 CRM linkage (set when the beneficiary was picked from the CRM search).
  crmContactId: z.string().optional(),
  crmAccountId: z.string().optional(),
  // Multiple beneficiary contacts (from the same company) picked in the CRM flow.
  beneficiaryContacts: z.array(crmContactPickSchema).optional(),
  // The CRM opportunity whose Manual Rep Credit populated salesOpportunityUsd.
  crmOpportunityId: z.string().optional(),
  crmOpportunityName: z.string().optional(),
  // The Dynamics account owner (rep who owns the customer) captured at intake.
  accountOwner: z.string().optional(),
});
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const updateRequestSchema = z.object({
  quantity: z.coerce.number().int().positive().optional(),
  notes: z.string().optional(),
  salesOpportunityUsd: z.coerce.number().min(0).optional(),
  beneficiaryContactId: z.coerce.number().int().positive().optional().nullable(),
});
export type UpdateRequestInput = z.infer<typeof updateRequestSchema>;

export const requestQuery = z.object({
  gameId: z.coerce.number().int().positive().optional(),
  status: z.enum(REQUEST_STATUS).optional(),
  mine: z.coerce.boolean().optional(),
});

// Email-intake simulation: paste raw request text; the mock adapter parses each block.
export const importRequestsSchema = z.object({
  gameId: z.coerce.number().int().positive().optional(),
  rawText: z.string().min(1),
});
export type ImportRequestsInput = z.infer<typeof importRequestsSchema>;

// Dynamics CRM search (request-intake picker).
export const crmSearchQuery = z.object({
  q: z.string().min(1),
});
