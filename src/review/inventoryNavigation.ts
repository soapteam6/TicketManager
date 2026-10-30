import type { InventoryView, ReviewSnapshot } from './types';

export type InventoryScope = { kind: 'season'; seasonId: string } | { kind: 'independent' };

export function scopedInventory(catalog: InventoryView[], scope: InventoryScope): InventoryView[] {
  return catalog.filter(game => scope.kind === 'season' ? game.seasonId === scope.seasonId : !game.seasonId);
}

export function inventoryTotals(games: InventoryView[]) {
  const scheduled = games.filter(game => game.status === 'scheduled');
  return {
    scheduled: scheduled.length,
    historical: games.length - scheduled.length,
    tickets: scheduled.reduce((sum, game) => sum + game.totalTickets, 0),
    available: scheduled.reduce((sum, game) => sum + game.availableTickets, 0),
  };
}

export function inventoryHierarchy(snapshot: ReviewSnapshot) {
  const coordinator = snapshot.persona.role === 'coordinator';
  const teams = new Map((coordinator ? snapshot.teams : []).map(team => [team.id, team]));
  const seasons = new Map((coordinator ? snapshot.seasons : []).map(season => [season.id, season]));
  // Requesters get grouping metadata only for events already visible to them.
  // Never infer their cards or totals from the coordinator's private inventory.
  for (const game of snapshot.catalog) {
    if (!game.seasonId) continue;
    let season = seasons.get(game.seasonId);
    if (!season) {
      season = { id: game.seasonId, teamId: game.teamId || `season:${game.seasonId}`, label: game.seasonLabel || 'Season', startDate: '', endDate: '' };
      seasons.set(season.id, season);
    }
    if (!teams.has(season.teamId)) teams.set(season.teamId, { id: season.teamId, name: game.teamName || 'Team inventory', defaultTickets: 0 });
  }
  return {
    teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name)),
    seasons: [...seasons.values()].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.label.localeCompare(a.label, undefined, { numeric: true })),
  };
}

export function scopedWindowIds(games: InventoryView[], ids: string[], from: string, through: string): string[] {
  const start = Date.parse(from), end = Date.parse(through);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('Choose a valid event date window.');
  const allowed = new Set(ids);
  const selected = games.filter(game => allowed.has(game.id) && Date.parse(game.gameDate) >= start && Date.parse(game.gameDate) <= end).map(game => game.id);
  if (!selected.length) throw new Error('No events in this inventory match the date window.');
  return selected;
}
