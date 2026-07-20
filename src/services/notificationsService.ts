import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import { gameStatusChoice, seatStatusChoice } from '../dataverse/choiceMaps';
import { logIntegration } from './integrationLogService';
import type { NotifyAudience } from '../domain/enums';

export interface AvailabilitySummary {
  availableSeats: number;
  gamesWithAvailability: number;
  message: string;
}

// Counts available seats across upcoming (scheduled / transfer_pending) games and how many distinct
// games still have open seats, then builds a suggested broadcast message.
export async function getAvailabilitySummary(): Promise<AvailabilitySummary> {
  const openStatuses = ['scheduled', 'transfer_pending'] as const;
  const gameFilter = openStatuses.map((s) => `cr9cd_status eq ${gameStatusChoice.toCode(s)}`).join(' or ');
  const [gamesResult, seatsResult] = await Promise.all([
    Cr9cd_gamesService.getAll({ filter: `(${gameFilter})`, select: ['cr9cd_gameid'] }),
    Cr9cd_seatsService.getAll({ filter: `cr9cd_status eq ${seatStatusChoice.toCode('available')}`, select: ['_cr9cd_game_value'] }),
  ]);
  const openGameIds = new Set((gamesResult.data ?? []).map((g) => g.cr9cd_gameid));

  let availableSeats = 0;
  const gamesWith = new Set<string>();
  for (const seat of seatsResult.data ?? []) {
    const gid = seat._cr9cd_game_value;
    if (gid && openGameIds.has(gid)) {
      availableSeats += 1;
      gamesWith.add(gid);
    }
  }
  const gamesWithAvailability = gamesWith.size;
  const message =
    availableSeats > 0
      ? `We have ${availableSeats} ticket${availableSeats === 1 ? '' : 's'} available across ${gamesWithAvailability} upcoming game${
          gamesWithAvailability === 1 ? '' : 's'
        }. Reply to claim yours before they're gone!`
      : 'There are no open tickets right now — check back soon!';
  return { availableSeats, gamesWithAvailability, message };
}

// Records an availability broadcast via the 'notification' integration adapter. Mock-up: this is an
// audit-trail entry only (no real email/SMS delivery), mirroring the rest of the integration layer.
export async function broadcastAvailability(audience: NotifyAudience, message: string): Promise<void> {
  await logIntegration({
    adapter: 'notification',
    operation: `availability-broadcast:${audience}`,
    status: 'success',
    payload: { audience, message },
    response: { message },
  });
}
