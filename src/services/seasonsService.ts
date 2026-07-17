import { Cr9cd_seasonsService } from '../generated/services/Cr9cd_seasonsService';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { deleteGame } from './gamesService';

export async function countSeasonDependents(seasonId: string): Promise<{ games: number }> {
  const games = await Cr9cd_gamesService.getAll({ filter: `_cr9cd_season_value eq ${seasonId}`, select: ['cr9cd_gameid'] });
  return { games: games.data?.length ?? 0 };
}

// Cascades through every game/event in the season (each of which cascades its own seats/requests/
// assignments/etc. via deleteGame) before deleting the season itself, so referential integrity
// never blocks the season delete at the end.
export async function deleteSeason(seasonId: string): Promise<void> {
  const games = await Cr9cd_gamesService.getAll({ filter: `_cr9cd_season_value eq ${seasonId}`, select: ['cr9cd_gameid'] });
  for (const g of games.data ?? []) await deleteGame(g.cr9cd_gameid);
  await Cr9cd_seasonsService.delete(seasonId);
}
