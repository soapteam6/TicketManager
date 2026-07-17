import type { FactorKey } from './enums.js';

// Per-factor contribution to a request's priority score — surfaced in the UI for transparency.
export interface FactorContribution {
  factor: FactorKey;
  label: string;
  rawValue: number | null;
  normalizedValue: number; // 0..1
  weight: number;
  weightedContribution: number;
  sharePct: number; // signed share of the total (for the breakdown bar)
  explanation: string;
}

export interface ScoredRequestResult {
  requestId: number;
  contactId: number | null;
  finalScore: number;
  breakdown: FactorContribution[];
  configId: number;
}

export type RequestRecommendation = 'award' | 'waitlist';

export interface RankedRequest extends ScoredRequestResult {
  rank: number;
  quantity: number;
  requesterName: string;
  contactType: 'customer' | 'employee' | null;
  recommendation: RequestRecommendation;
}

export interface GameRankingResult {
  gameId: number;
  configId: number;
  seatsAvailable: number;
  seatsRemaining: number;
  ranked: RankedRequest[];
}
