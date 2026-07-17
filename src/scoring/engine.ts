import {
  FACTOR_KEYS,
  TIER_RANK,
} from '../domain/enums';
import { FACTOR_LABELS } from '../domain/constants';
import type { FactorContribution, ScoredRequestResult, RankedRequest, GameRankingResult } from '../domain/scoring-types';
import { FACTORS } from './factors';
import type { ResolvedScoringConfig, ScoringContext, ScoringGameInput, ScoringRequestInput, PoolStats } from './types';

// Score a single request against the active config, returning the full factor breakdown.
export function scoreRequest(req: ScoringRequestInput, ctx: ScoringContext): ScoredRequestResult {
  const contributions: FactorContribution[] = [];
  for (const key of FACTOR_KEYS) {
    const weight = ctx.config.weights[key] ?? 0;
    const { raw, norm, explain } = FACTORS[key].extract(req, ctx);
    contributions.push({
      factor: key,
      label: FACTOR_LABELS[key],
      rawValue: raw,
      normalizedValue: Number(norm.toFixed(4)),
      weight,
      weightedContribution: Number((weight * norm).toFixed(4)),
      sharePct: 0,
      explanation: explain,
    });
  }
  const finalScore = contributions.reduce((s, c) => s + c.weightedContribution, 0);
  const totalAbs = contributions.reduce((s, c) => s + Math.abs(c.weightedContribution), 0) || 1;
  for (const c of contributions) c.sharePct = Number(((100 * c.weightedContribution) / totalAbs).toFixed(1));

  return {
    requestId: req.requestId,
    contactId: req.contactId,
    finalScore: Number(finalScore.toFixed(4)),
    breakdown: contributions,
    configId: ctx.config.id,
  };
}

function computePool(requests: ScoringRequestInput[]): PoolStats {
  let employeeCount = 0;
  let customerCount = 0;
  for (const r of requests) {
    if (r.contactType === 'employee') employeeCount++;
    else if (r.contactType === 'customer') customerCount++;
  }
  return { total: requests.length, employeeCount, customerCount };
}

// Score, rank (deterministic tiebreak chain), and greedily allocate against inventory.
export function rankGameRequests(
  requests: ScoringRequestInput[],
  game: ScoringGameInput,
  config: ResolvedScoringConfig,
  seatsAvailable: number,
  now: number
): GameRankingResult {
  const ctx: ScoringContext = { game, config, pool: computePool(requests), now };
  const byId = new Map(requests.map((r) => [r.requestId, r]));

  const scored = requests.map((r) => scoreRequest(r, ctx));

  scored.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    const ra = byId.get(a.requestId)!;
    const rb = byId.get(b.requestId)!;
    // Tiebreak: tier desc -> attendance rate desc -> earlier request -> id (stable).
    if (TIER_RANK[rb.tier] !== TIER_RANK[ra.tier]) return TIER_RANK[rb.tier] - TIER_RANK[ra.tier];
    const attA = ra.awardedCount ? ra.attendedCount / ra.awardedCount : 0;
    const attB = rb.awardedCount ? rb.attendedCount / rb.awardedCount : 0;
    if (attB !== attA) return attB - attA;
    if (ra.createdAt !== rb.createdAt) return ra.createdAt - rb.createdAt;
    return a.requestId.localeCompare(b.requestId);
  });

  let remaining = seatsAvailable;
  const ranked: RankedRequest[] = scored.map((s, i) => {
    const r = byId.get(s.requestId)!;
    const canAward = r.quantity <= remaining;
    if (canAward) remaining -= r.quantity;
    return {
      ...s,
      rank: i + 1,
      quantity: r.quantity,
      requesterName: r.requesterName,
      contactType: r.contactType,
      recommendation: canAward ? 'award' : 'waitlist',
    };
  });

  return { gameId: game.id, configId: config.id, seatsAvailable, seatsRemaining: remaining, ranked };
}
