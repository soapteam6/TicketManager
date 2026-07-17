import { Cr9cd_teamsService } from '../generated/services/Cr9cd_teamsService';
import { Cr9cd_seasonsService } from '../generated/services/Cr9cd_seasonsService';
import { deleteSeason } from './seasonsService';

export async function countTeamDependents(teamId: string): Promise<{ seasons: number }> {
  const seasons = await Cr9cd_seasonsService.getAll({ filter: `_cr9cd_team_value eq ${teamId}`, select: ['cr9cd_seasonid'] });
  return { seasons: seasons.data?.length ?? 0 };
}

// Cascades through every season under the team (each of which cascades its own games/events via
// deleteSeason) before deleting the team itself, so referential integrity never blocks the delete.
export async function deleteTeam(teamId: string): Promise<void> {
  const seasons = await Cr9cd_seasonsService.getAll({ filter: `_cr9cd_team_value eq ${teamId}`, select: ['cr9cd_seasonid'] });
  for (const s of seasons.data ?? []) await deleteSeason(s.cr9cd_seasonid);
  await Cr9cd_teamsService.delete(teamId);
}
