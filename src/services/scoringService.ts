import { Cr9cd_scoringconfigsService } from '../generated/services/Cr9cd_scoringconfigsService';
import { Cr9cd_ticketrequestsService } from '../generated/services/Cr9cd_ticketrequestsService';
import { Cr9cd_contact_beneficiariesService } from '../generated/services/Cr9cd_contact_beneficiariesService';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import type { Cr9cd_contact_beneficiaries } from '../generated/models/Cr9cd_contact_beneficiariesModel';
import { bindRef } from '../dataverse/bind';
import { requestStatusChoice, contactTypeChoice, valueTierChoice, futurePriorityChoice, seatStatusChoice } from '../dataverse/choiceMaps';
import { DEFAULT_SCORING_WEIGHTS, DEFAULT_SCORING_PARAMS } from '../domain/constants';
import type { ScoringParams } from '../domain/constants';
import type { FactorKey, RequestStatus } from '../domain/enums';
import { rankGameRequests } from '../scoring/engine';
import type { ScoringRequestInput, ScoringGameInput, ResolvedScoringConfig } from '../scoring/types';
import type { GameRankingResult } from '../domain/scoring-types';

export interface ScoringConfigRecord {
  id: string;
  version: number;
  weights: Record<FactorKey, number>;
  params: ScoringParams;
}

function parseWeights(json: string | undefined): Record<FactorKey, number> {
  if (!json) return { ...DEFAULT_SCORING_WEIGHTS };
  try {
    return JSON.parse(json);
  } catch {
    return { ...DEFAULT_SCORING_WEIGHTS };
  }
}

function parseParams(json: string | undefined): ScoringParams {
  if (!json) return { ...DEFAULT_SCORING_PARAMS };
  try {
    return JSON.parse(json);
  } catch {
    return { ...DEFAULT_SCORING_PARAMS };
  }
}

// Requests still "in play" for a game -- terminal statuses (approved/fulfilled/waitlisted/declined/cancelled) are left alone.
const SCORABLE_STATUSES: RequestStatus[] = ['submitted', 'scored', 'recommended'];

export async function getActiveScoringConfig(): Promise<ScoringConfigRecord> {
  const result = await Cr9cd_scoringconfigsService.getAll({
    filter: 'cr9cd_is_active eq true',
    top: 1,
  });
  const row = result.data?.[0];
  if (!row) {
    return { id: '', version: 0, weights: { ...DEFAULT_SCORING_WEIGHTS }, params: { ...DEFAULT_SCORING_PARAMS } };
  }
  return {
    id: row.cr9cd_scoringconfigid,
    version: row.cr9cd_version ?? 1,
    weights: parseWeights(row.cr9cd_weights),
    params: parseParams(row.cr9cd_params),
  };
}

// No platform-enforced "only one active" constraint (see memory-bank.md) -- deactivate everyone else, then activate the target.
export async function activateScoringConfig(configId: string): Promise<void> {
  const all = await Cr9cd_scoringconfigsService.getAll({ select: ['cr9cd_scoringconfigid', 'cr9cd_is_active'] });
  for (const row of all.data ?? []) {
    if (row.cr9cd_scoringconfigid !== configId && row.cr9cd_is_active) {
      await Cr9cd_scoringconfigsService.update(row.cr9cd_scoringconfigid, { cr9cd_is_active: false });
    }
  }
  await Cr9cd_scoringconfigsService.update(configId, { cr9cd_is_active: true });
}

export async function createScoringConfig(
  weights: Record<FactorKey, number>,
  params: ScoringParams,
  activate: boolean
): Promise<string> {
  const existing = await Cr9cd_scoringconfigsService.getAll({
    select: ['cr9cd_version'],
    orderBy: ['cr9cd_version desc'],
    top: 1,
  });
  const nextVersion = (existing.data?.[0]?.cr9cd_version ?? 0) + 1;
  const created = await Cr9cd_scoringconfigsService.create({
    cr9cd_name: `Config v${nextVersion}`,
    cr9cd_version: nextVersion,
    cr9cd_weights: JSON.stringify(weights),
    cr9cd_params: JSON.stringify(params),
    cr9cd_is_active: false,
  } as Parameters<typeof Cr9cd_scoringconfigsService.create>[0]);
  if (!created.data) throw new Error('Failed to create scoring config');
  const id = created.data.cr9cd_scoringconfigid;
  if (activate) await activateScoringConfig(id);
  return id;
}

// Scores every in-play request for a game against the active config and writes back
// priorityScore/priorityRank/scoringBreakdown/status. Pure ranking math lives in ../scoring/engine.
export async function scoreGame(gameId: string): Promise<GameRankingResult> {
  const [gameResult, config] = await Promise.all([Cr9cd_gamesService.get(gameId), getActiveScoringConfig()]);
  const game = gameResult.data;
  if (!game) throw new Error('Game not found');

  const statusFilter = SCORABLE_STATUSES.map((s) => `cr9cd_status eq ${requestStatusChoice.toCode(s)}`).join(' or ');
  const requestsResult = await Cr9cd_ticketrequestsService.getAll({
    filter: `_cr9cd_game_value eq ${gameId} and (${statusFilter})`,
  });
  const requests = requestsResult.data ?? [];

  const contactIds = [...new Set(requests.map((r) => r._cr9cd_beneficiary_contact_value).filter((v): v is string => Boolean(v)))];
  const contactsById = new Map<string, Cr9cd_contact_beneficiaries>();
  if (contactIds.length > 0) {
    const contactsFilter = contactIds.map((id) => `cr9cd_contact_beneficiaryid eq ${id}`).join(' or ');
    const contactsResult = await Cr9cd_contact_beneficiariesService.getAll({ filter: contactsFilter });
    for (const c of contactsResult.data ?? []) contactsById.set(c.cr9cd_contact_beneficiaryid, c);
  }

  const seatsResult = await Cr9cd_seatsService.getAll({
    filter: `_cr9cd_game_value eq ${gameId} and cr9cd_status eq ${seatStatusChoice.toCode('available')}`,
    select: ['cr9cd_seatid'],
  });
  const seatsAvailable = seatsResult.data?.length ?? 0;

  const now = Date.now();
  const scoringInputs: ScoringRequestInput[] = requests.map((r) => {
    const contact = r._cr9cd_beneficiary_contact_value ? contactsById.get(r._cr9cd_beneficiary_contact_value) : undefined;
    return {
      requestId: r.cr9cd_ticketrequestid,
      contactId: r._cr9cd_beneficiary_contact_value ?? null,
      contactType: r.cr9cd_beneficiary_type != null ? contactTypeChoice.toValue(r.cr9cd_beneficiary_type) : null,
      requesterName: r.cr9cd_requester_name ?? '',
      quantity: r.cr9cd_quantity ?? 1,
      salesOpportunityUsd: r.cr9cd_sales_opportunity_usd ?? 0,
      createdAt: r.createdon ? new Date(r.createdon).getTime() : now,
      tier: contact?.cr9cd_value_tier != null ? valueTierChoice.toValue(contact.cr9cd_value_tier) : 'prospect',
      attendedCount: contact?.cr9cd_attended_count ?? 0,
      awardedCount: contact?.cr9cd_awarded_count ?? 0,
      noShowCount: contact?.cr9cd_no_show_count ?? 0,
      lastTicketDate: contact?.cr9cd_last_ticket_date ? new Date(contact.cr9cd_last_ticket_date).getTime() : null,
      futurePriorityFlag: contact?.cr9cd_future_priority_flag != null ? futurePriorityChoice.toValue(contact.cr9cd_future_priority_flag) : 'normal',
    };
  });

  const gameInput: ScoringGameInput = {
    id: gameId,
    gameDate: game.cr9cd_game_date ? new Date(game.cr9cd_game_date).getTime() : now,
    premiumScore: game.cr9cd_premium_score ?? 0,
  };
  const resolvedConfig: ResolvedScoringConfig = { id: config.id, weights: config.weights, params: config.params };

  const result = rankGameRequests(scoringInputs, gameInput, resolvedConfig, seatsAvailable, now);

  await Promise.all(
    result.ranked.map((ranked) =>
      Cr9cd_ticketrequestsService.update(ranked.requestId, {
        cr9cd_priority_score: ranked.finalScore,
        cr9cd_priority_rank: ranked.rank,
        cr9cd_scoring_breakdown: JSON.stringify(ranked.breakdown),
        cr9cd_status: requestStatusChoice.toCode('scored'),
        ...(config.id ? { 'cr9cd_Scoring_Config@odata.bind': bindRef('cr9cd_scoringconfigs', config.id) } : {}),
      })
    )
  );

  return result;
}
