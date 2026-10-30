import { describe, expect, it } from 'vitest';
import { createFixtures, GUID } from './fixtures';
import { MockReviewProvider } from './provider';

const now = () => Date.parse('2026-10-30T12:00:00Z');
async function imported() {
  const provider = new MockReviewProvider(now);
  await provider.execute('coordinator', { type: 'importSchedule', seasonId: '',
    newSeason: { teamId: '', teamName: 'Deletion example', label: '2027 example', startDate: '2027-01-01', endDate: '2027-12-31', defaultTickets: 2 },
    csv: 'date,time,title,tickets,kind\n2027-01-10,03:00,Delete game one,2,game\n2027-01-11,03:00,Delete game two,2,game' });
  const snapshot = provider.snapshot('coordinator');
  const team = snapshot.teams.find(t => t.name === 'Deletion example')!;
  const season = snapshot.seasons.find(s => s.teamId === team.id)!;
  const games = snapshot.catalog.filter(g => g.seasonId === season.id);
  return { provider, team, season, games };
}
describe('inventory hierarchy deletion', () => {
  it('deletes an imported team and all unused descendants while leaving unrelated inventory intact', async () => {
    const { provider, team, season, games } = await imported();
    const before = provider.snapshot('coordinator');
    await provider.execute('coordinator', { type: 'removeTeam', teamId: team.id });
    const after = provider.snapshot('coordinator');
    expect(after.teams.some(t => t.id === team.id)).toBe(false);
    expect(after.seasons.some(s => s.id === season.id)).toBe(false);
    expect(after.catalog.some(g => games.some(x => x.id === g.id))).toBe(false);
    expect(after.catalog).toEqual(before.catalog.filter(g => g.seasonId !== season.id));
    expect(after.requests).toEqual(before.requests);
    expect(after.allocations).toEqual(before.allocations);
    await expect(provider.execute('coordinator', { type: 'createSeason', teamId: team.id, label: 'Invalid reuse', startDate: '2027-01-01', endDate: '2027-12-31' })).rejects.toThrow();
    await expect(provider.execute('coordinator', { type: 'createInventory', kind: 'game', seasonId: season.id, title: 'Invalid game', gameDate: '2027-02-01T00:00:00Z', tickets: 1 })).rejects.toThrow();
    await expect(provider.execute('coordinator', { type: 'importSchedule', seasonId: season.id, csv: 'date,time,title,tickets,kind\n2027-02-01,00:00,Invalid import,1,game' })).rejects.toThrow();
    await provider.execute('coordinator', { type: 'createTeam', name: team.name, defaultTickets: 2 });
    expect(provider.snapshot('coordinator').teams.filter(t => t.name === team.name)).toHaveLength(1);
  });
  it('deletes a season and its games while retaining the parent and allows a replacement with the same label', async () => {
    const { provider, team, season } = await imported();
    await provider.execute('coordinator', { type: 'removeSeason', seasonId: season.id });
    const snapshot = provider.snapshot('coordinator');
    expect(snapshot.teams.some(t => t.id === team.id)).toBe(true);
    expect(snapshot.seasons.some(s => s.id === season.id)).toBe(false);
    expect(snapshot.catalog.some(g => g.seasonId === season.id)).toBe(false);
    await provider.execute('coordinator', { type: 'createSeason', teamId: team.id, label: season.label, startDate: season.startDate, endDate: season.endDate });
    expect(provider.snapshot('coordinator').seasons.some(s => s.label === season.label)).toBe(true);
  });
  it('deletes an individual game without deleting its season or other games', async () => {
    const { provider, season, games } = await imported();
    await provider.execute('coordinator', { type: 'removeInventory', gameId: games[0].id });
    expect(provider.snapshot('coordinator').catalog.filter(g => g.seasonId === season.id).map(g => g.id)).toEqual([games[1].id]);
  });
  it('blocks the entire deletion when any descendant has even cancelled history', async () => {
    const state = createFixtures(); state.requests[0].status = 'cancelled';
    const provider = new MockReviewProvider(now, undefined, state), before = provider.snapshot('coordinator');
    for (const command of [{ type: 'removeTeam' as const, teamId: GUID(2, 1) }, { type: 'removeSeason' as const, seasonId: GUID(3, 1) }]) {
      await expect(provider.execute('coordinator', command)).rejects.toThrow('history');
      expect(provider.snapshot('coordinator')).toEqual(before);
    }
  });
  it('denies employee and sales-rep deletion without changing anything', async () => {
    const { provider, team, season } = await imported(), before = provider.snapshot('coordinator');
    for (const actor of ['employee', 'rep'] as const) {
      await expect(provider.execute(actor, { type: 'removeTeam', teamId: team.id })).rejects.toThrow('Coordinator');
      await expect(provider.execute(actor, { type: 'removeSeason', seasonId: season.id })).rejects.toThrow('Coordinator');
    }
    expect(provider.snapshot('coordinator')).toEqual(before);
  });
});
