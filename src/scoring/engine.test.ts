import { describe, it, expect } from 'vitest';
import { DEFAULT_SCORING_WEIGHTS, DEFAULT_SCORING_PARAMS } from '../domain/constants';
import { rankGameRequests, scoreRequest } from './engine';
import type { ResolvedScoringConfig, ScoringGameInput, ScoringRequestInput, ScoringContext } from './types';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const config: ResolvedScoringConfig = {
  id: 'config-1',
  weights: { ...DEFAULT_SCORING_WEIGHTS },
  params: { ...DEFAULT_SCORING_PARAMS },
};

const game: ScoringGameInput = { id: 'game-1', gameDate: NOW + 21 * DAY, premiumScore: 0.8 };

function req(partial: Partial<ScoringRequestInput> & { requestId: string }): ScoringRequestInput {
  return {
    contactId: partial.requestId,
    contactType: 'customer',
    requesterName: `R${partial.requestId}`,
    quantity: 1,
    salesOpportunityUsd: 0,
    createdAt: NOW,
    tier: 'silver',
    attendedCount: 0,
    awardedCount: 0,
    noShowCount: 0,
    lastTicketDate: null,
    futurePriorityFlag: 'normal',
    ...partial,
  };
}

describe('scoreRequest', () => {
  it('is deterministic and produces a breakdown that sums to the final score', () => {
    const ctx: ScoringContext = { game, config, pool: { total: 1, employeeCount: 0, customerCount: 1 }, now: NOW };
    const r = req({ requestId: 'req-1', tier: 'platinum', salesOpportunityUsd: 50000 });
    const a = scoreRequest(r, ctx);
    const b = scoreRequest(r, ctx);
    expect(a.finalScore).toEqual(b.finalScore);
    const sum = a.breakdown.reduce((s, c) => s + c.weightedContribution, 0);
    expect(Math.abs(sum - a.finalScore)).toBeLessThan(1e-6);
    expect(a.breakdown).toHaveLength(Object.keys(DEFAULT_SCORING_WEIGHTS).length);
  });

  it('ranks a high-value, high-opportunity customer above a low-tier one', () => {
    const high = rankGameRequests(
      [req({ requestId: 'req-1', tier: 'platinum', salesOpportunityUsd: 50000, attendedCount: 9, awardedCount: 10 })],
      game,
      config,
      5,
      NOW
    ).ranked[0].finalScore;
    const low = rankGameRequests([req({ requestId: 'req-2', tier: 'prospect' })], game, config, 5, NOW).ranked[0].finalScore;
    expect(high).toBeGreaterThan(low);
  });
});

describe('rankGameRequests', () => {
  it('allocates against inventory: awards up to capacity, waitlists the rest', () => {
    const requests = ['req-1', 'req-2', 'req-3', 'req-4'].map((id) => req({ requestId: id, quantity: 2 }));
    const result = rankGameRequests(requests, game, config, 5, NOW);
    const awarded = result.ranked.filter((r) => r.recommendation === 'award');
    const totalAwardedSeats = awarded.reduce((s, r) => s + r.quantity, 0);
    expect(totalAwardedSeats).toBeLessThanOrEqual(5);
    expect(result.ranked.some((r) => r.recommendation === 'waitlist')).toBe(true);
    // Ranks are 1..n, contiguous.
    expect(result.ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it('breaks ties deterministically by tier then earlier request', () => {
    // Two identical-scoring requests except tier; higher tier must rank first.
    const a = req({ requestId: 'req-10', tier: 'gold', createdAt: NOW });
    const b = req({ requestId: 'req-11', tier: 'bronze', createdAt: NOW });
    const result = rankGameRequests([b, a], game, config, 5, NOW);
    expect(result.ranked[0].requestId).toBe('req-10');
  });

  it('rewards fairness: a never-awarded requester outscores an identical recently-awarded one', () => {
    const fresh = req({ requestId: 'req-20', lastTicketDate: null });
    const recent = req({ requestId: 'req-21', lastTicketDate: NOW - 2 * DAY });
    const result = rankGameRequests([recent, fresh], game, config, 5, NOW);
    const freshScore = result.ranked.find((r) => r.requestId === 'req-20')!.finalScore;
    const recentScore = result.ranked.find((r) => r.requestId === 'req-21')!.finalScore;
    expect(freshScore).toBeGreaterThan(recentScore);
  });
});
