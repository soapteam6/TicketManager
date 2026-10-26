import { DEFAULT_SCORING_PARAMS } from '../domain/constants';
import { rankGameRequests } from '../scoring/engine';
import type { GameRankingResult } from '../domain/scoring-types';
import type { ScoringRequestInput } from '../scoring/types';
import type { Allocation, ReviewState } from './types';
function fail(message: string): never { throw new Error(message); }
function instant(value: string) { return Date.parse(value); }
function active(a: Allocation) { return a.status !== 'cancelled'; }
export function rankReviewState(state: ReviewState, gameId: string, now: number): GameRankingResult {
    const game = state.games.find((g) => g.id === gameId);
    if (!game) fail('Select an inventory item to score');
    const inputs: ScoringRequestInput[] = state.requests
      .filter(
        (r) =>
          r.gameId === gameId && !['cancelled', 'fulfilled'].includes(r.status),
      )
      .map((r) => {
        const contacts = state.contacts.filter((c) =>
          r.contactIds.includes(c.id),
        );
        const primary = contacts[0];
        const history = state.allocations.filter((a) =>
          r.contactIds.includes(a.contactId),
        );
        const seasonAwards = new Set(
          state.allocations
            .filter(
              (a) =>
                active(a) &&
                a.requestId !== r.id &&
                game.seasonId !== null &&
                state.games.find((g) => g.id === a.gameId)?.seasonId ===
                  game.seasonId &&
                (r.contactIds.includes(a.contactId) ||
                  (r.purpose === 'customer' &&
                    state.contacts.find((c) => c.id === a.contactId)
                      ?.company === primary?.company)),
            )
            .map((a) => a.requestId),
        ).size;
        return {
          requestId: r.id,
          contactId: primary?.id ?? null,
          contactType: r.purpose,
          requesterName: contacts.map((c) => c.name).join(', '),
          quantity:
            r.quantity -
            state.allocations.filter((a) => a.requestId === r.id && active(a))
              .length,
          salesOpportunityUsd: 0,
          createdAt: instant(r.createdAt),
          businessRationale: r.rationale,
          opportunityName: r.opportunity,
          seasonAwardCount: seasonAwards,
          tier: primary?.tier ?? 'prospect',
          attendedCount: history.filter((a) => a.outcome === 'attended').length,
          noShowCount: history.filter((a) => a.outcome === 'no_show').length,
          awardedCount: history.length,
          lastTicketDate: null,
          futurePriorityFlag: 'normal',
        };
      });
    return rankGameRequests(
      inputs,
      { id: game.id, gameDate: instant(game.gameDate), premiumScore: 0.5 },
      {
        id: 'mock-review',
        weights: { ...state.scoring.weights },
        params: {
          ...DEFAULT_SCORING_PARAMS,
          categoryCustomerScore: state.scoring.category.customer,
          categoryProspectScore: state.scoring.category.prospect,
          categoryEmployeeScore: state.scoring.category.employee,
        },
      },
      state.seats.filter((s) => s.gameId === gameId && s.status === 'available')
        .length,
      now,
    );
}
