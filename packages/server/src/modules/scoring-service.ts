import { and, eq, inArray } from 'drizzle-orm';
import {
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_SCORING_PARAMS,
  type FactorKey,
  type ScoringParams,
  type GameRankingResult,
} from '@ais/shared';
import { db } from '../db/client.js';
import { games, seats, ticketRequests, contacts, scoringConfigs } from '../db/schema.js';
import { rankGameRequests } from '../scoring/engine.js';
import type { ResolvedScoringConfig, ScoringRequestInput, ScoringGameInput } from '../scoring/types.js';
import { getNarrativeAdapter, type NarrativeRequest, type NarrativeResult } from '../narrative/index.js';
import { notFound } from '../lib/errors.js';

// Requests in these statuses are still competing for seats.
const SCOREABLE_STATUSES = ['submitted', 'scored', 'recommended', 'waitlisted'];

export function getActiveConfig(): ResolvedScoringConfig {
  const row = db.select().from(scoringConfigs).where(eq(scoringConfigs.isActive, 1)).get();
  if (!row) {
    return { id: 0, weights: { ...DEFAULT_SCORING_WEIGHTS }, params: { ...DEFAULT_SCORING_PARAMS } };
  }
  return {
    id: row.id,
    weights: JSON.parse(row.weights) as Record<FactorKey, number>,
    params: JSON.parse(row.params) as ScoringParams,
  };
}

export function availableSeatCount(gameId: number): number {
  const rows = db.select({ id: seats.id }).from(seats).where(and(eq(seats.gameId, gameId), eq(seats.status, 'available'))).all();
  return rows.length;
}

function buildInputs(gameId: number): ScoringRequestInput[] {
  const rows = db
    .select({ req: ticketRequests, contact: contacts })
    .from(ticketRequests)
    .leftJoin(contacts, eq(ticketRequests.beneficiaryContactId, contacts.id))
    .where(and(eq(ticketRequests.gameId, gameId), inArray(ticketRequests.status, SCOREABLE_STATUSES)))
    .all();

  return rows.map(({ req, contact }) => ({
    requestId: req.id,
    contactId: req.beneficiaryContactId ?? null,
    contactType: (contact?.type ?? req.beneficiaryType) as ScoringRequestInput['contactType'],
    requesterName: req.requesterName ?? contact?.fullName ?? 'Unknown',
    quantity: req.quantity,
    salesOpportunityUsd: req.salesOpportunityUsd ?? 0,
    createdAt: req.createdAt,
    tier: (contact?.valueTier ?? 'prospect') as ScoringRequestInput['tier'],
    attendedCount: contact?.attendedCount ?? 0,
    awardedCount: contact?.awardedCount ?? 0,
    noShowCount: contact?.noShowCount ?? 0,
    lastTicketDate: contact?.lastTicketDate ?? null,
    futurePriorityFlag: (contact?.futurePriorityFlag ?? 'normal') as ScoringRequestInput['futurePriorityFlag'],
  }));
}

// Score every competing request for a game, persist scores/ranks/breakdown, and return the ranking.
export function scoreGame(gameId: number): GameRankingResult {
  const game = db.select().from(games).where(eq(games.id, gameId)).get();
  if (!game) throw notFound('Game not found');

  const config = getActiveConfig();
  const inputs = buildInputs(gameId);
  const gameInput: ScoringGameInput = { id: game.id, gameDate: game.gameDate, premiumScore: game.premiumScore };
  const ranking = rankGameRequests(inputs, gameInput, config, availableSeatCount(gameId), Date.now());

  // Persist per-request score, rank, and breakdown for transparency/reproducibility.
  const now = Date.now();
  db.transaction(() => {
    for (const r of ranking.ranked) {
      db.update(ticketRequests)
        .set({
          priorityScore: r.finalScore,
          priorityRank: r.rank,
          scoringBreakdown: JSON.stringify(r.breakdown),
          scoringConfigId: config.id > 0 ? config.id : null,
          status: 'scored',
          updatedAt: now,
        })
        .where(eq(ticketRequests.id, r.requestId))
        .run();
    }
  });

  return ranking;
}

export async function scoreGameWithNarrative(
  gameId: number
): Promise<{ ranking: GameRankingResult; narrative: NarrativeResult }> {
  const ranking = scoreGame(gameId);
  const game = db.select().from(games).where(eq(games.id, gameId)).get()!;

  const narrativeInput: NarrativeRequest = {
    game: { team: '', opponent: game.opponent, gameDate: new Date(game.gameDate).toISOString().slice(0, 10) },
    ranked: ranking.ranked.slice(0, 8).map((r) => ({
      rank: r.rank,
      requesterName: r.requesterName,
      requesterType: r.contactType,
      finalScore: r.finalScore,
      recommendation: r.recommendation,
      topFactors: [...r.breakdown]
        .sort((a, b) => Math.abs(b.weightedContribution) - Math.abs(a.weightedContribution))
        .slice(0, 3)
        .map((f) => ({ factor: f.factor, label: f.label, sharePct: f.sharePct, explanation: f.explanation })),
    })),
  };

  const narrative = await getNarrativeAdapter().explainRanking(narrativeInput);
  return { ranking, narrative };
}
