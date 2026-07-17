// The scoring engine DECIDES; this layer only EXPLAINS. Implementations are fed the
// already-computed breakdown and must never invent or recompute scores.

export interface NarrativeRankedItem {
  rank: number;
  requesterName: string;
  requesterType: 'customer' | 'employee' | null;
  finalScore: number;
  recommendation: 'award' | 'waitlist';
  topFactors: Array<{ factor: string; label: string; sharePct: number; explanation: string }>;
}

export interface NarrativeRequest {
  game: { team: string; opponent: string; gameDate: string };
  ranked: NarrativeRankedItem[];
  question?: string;
}

export interface NarrativeResult {
  available: boolean;
  narrative: string;
  source: 'anthropic' | 'fallback';
  model?: string;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

export interface NarrativeAdapter {
  isEnabled(): boolean;
  explainRanking(input: NarrativeRequest): Promise<NarrativeResult>;
}
