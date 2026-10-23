import { z } from 'zod';
import { isoTimestampSchema } from '../dates.js';
import type { GameKind, GameStatus } from '../enums.js';
import type { AuthUser } from './auth.js';

export const MOCK_PERSONAS = {
  coordinator: { email: 'coordinator@example.invalid', fullName: 'Demo Coordinator', role: 'admin' },
  rep: { email: 'rep@example.invalid', fullName: 'Demo Representative', role: 'sales_rep' },
  employee: { email: 'employee@example.invalid', fullName: 'Demo Employee', role: 'employee' },
} as const satisfies Record<string, Omit<AuthUser, 'id'>>;
export type MockPersonaKey = keyof typeof MOCK_PERSONAS;
export interface MockSession { user: AuthUser; mockOnly: true }
export interface RequestContactOption {
  id: number; fullName: string; company: string | null; type: 'customer' | 'employee';
  email: string | null; phone: string | null;
}
export interface RequestOptions { contacts: RequestContactOption[]; requesterUsers?: { id: number; fullName: string }[] }
export const releaseInventorySchema = z.object({
  gameIds: z.array(z.number().int().positive()).min(1).max(500).optional(),
  from: isoTimestampSchema.optional(),
  through: isoTimestampSchema.optional(),
  seasonId: z.number().int().positive().optional(),
  action: z.enum(['release', 'schedule', 'private']),
  releaseAt: isoTimestampSchema.optional(),
}).superRefine((input, ctx) => {
  if (!input.gameIds && (!input.from || !input.through)) ctx.addIssue({ code: 'custom', message: 'Select inventory or specify both date-window boundaries' });
  if (input.gameIds && (input.from || input.through)) ctx.addIssue({ code: 'custom', message: 'Choose selected inventory or a date window' });
  if (input.from && input.through && Date.parse(input.from) > Date.parse(input.through)) ctx.addIssue({ code: 'custom', message: 'Window end precedes start' });
  if (input.action === 'schedule' && !input.releaseAt) ctx.addIssue({ code: 'custom', message: 'A scheduled release requires an ISO timestamp with timezone' });
});
export type ReleaseInventoryInput = z.infer<typeof releaseInventorySchema>;
export interface DemandSummary {
  requestCount: number; requestingPeople: number; requestedTickets: number;
}
export interface FollowupTemplate {
  enabled: boolean; subject: string; body: string;
}

// Shared public catalog contract. Coordinator-only visibility fields are optional additions.
export interface ReviewInventoryItem extends DemandSummary {
  id: number;
  title: string | null;
  kind: GameKind;
  opponent: string;
  gameDate: number;
  teamName: string | null;
  availableSeats: number;
  totalSeats: number;
  status: GameStatus;
  released?: boolean;
  releaseStatus?: 'private' | 'released' | 'scheduled';
  releaseAt?: number | null;
}
