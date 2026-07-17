import type { FactorKey, ValueTier, FuturePriority, ContactType } from '../domain/enums';
import type { ScoringParams } from '../domain/constants';

// Decoupled scoring inputs — the scoring service maps Dataverse rows into these.
export interface ScoringRequestInput {
  requestId: string;
  contactId: string | null;
  contactType: ContactType | null;
  requesterName: string;
  quantity: number;
  salesOpportunityUsd: number;
  createdAt: number;
  // Beneficiary history rollups:
  tier: ValueTier;
  attendedCount: number;
  awardedCount: number;
  noShowCount: number;
  lastTicketDate: number | null;
  futurePriorityFlag: FuturePriority;
}

export interface ScoringGameInput {
  id: string;
  gameDate: number;
  premiumScore: number;
}

export interface PoolStats {
  total: number;
  employeeCount: number;
  customerCount: number;
}

export interface ResolvedScoringConfig {
  id: string;
  weights: Record<FactorKey, number>;
  params: ScoringParams;
}

export interface ScoringContext {
  game: ScoringGameInput;
  config: ResolvedScoringConfig;
  pool: PoolStats;
  now: number;
}

export interface FactorOutput {
  raw: number | null;
  norm: number; // clamped 0..1
  explain: string;
}

export interface Factor {
  key: FactorKey;
  extract(req: ScoringRequestInput, ctx: ScoringContext): FactorOutput;
}
