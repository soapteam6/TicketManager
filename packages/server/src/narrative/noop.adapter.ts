import type { NarrativeAdapter, NarrativeRequest, NarrativeResult } from './adapter.js';

// Used when no ANTHROPIC_API_KEY is present. Produces a deterministic, non-AI summary
// from the top factors so the UI still shows a rationale (marked as fallback).
export class NoopNarrativeAdapter implements NarrativeAdapter {
  isEnabled(): boolean {
    return false;
  }

  async explainRanking(input: NarrativeRequest): Promise<NarrativeResult> {
    const top = input.ranked[0];
    let narrative = '';
    if (top) {
      const drivers = top.topFactors
        .slice(0, 2)
        .map((f) => `${f.label} (${f.sharePct}%)`)
        .join(' and ');
      narrative = `${top.requesterName} ranks #1 (score ${top.finalScore.toFixed(2)}), driven mainly by ${drivers}. Enable the Claude narrative layer for a full plain-English explanation.`;
    }
    return { available: false, narrative, source: 'fallback' };
  }
}
