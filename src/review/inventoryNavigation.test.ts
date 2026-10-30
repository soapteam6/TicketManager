import { describe, expect, it } from 'vitest';
import { MockReviewProvider } from './provider';
import { createFixtures, GUID } from './fixtures';
import { inventoryHierarchy, inventoryTotals, scopedInventory, scopedWindowIds } from './inventoryNavigation';

const provider = () => new MockReviewProvider(() => Date.parse('2026-10-26T12:00:00Z'));
describe('inventory dashboards and setup', () => {
  it('totals scheduled tickets without counting historical availability', () => {
    const snapshot = provider().snapshot('coordinator');
    const games = scopedInventory(snapshot.catalog, { kind: 'season', seasonId: GUID(3, 1) });
    expect(inventoryTotals(games)).toEqual({ tickets: 8, available: 8, scheduled: 2, historical: 1 });
    expect(scopedInventory(snapshot.catalog, { kind: 'independent' }).map(g => g.title)).toEqual(['Synthetic Winter Performance']);
  });
  it('requester cards only reflect released catalog, including when full metadata is supplied', () => {
    const p = provider(); const snapshot = p.snapshot('employee'); const admin = p.snapshot('coordinator');
    snapshot.teams = [...admin.teams, { id: 'hidden', name: 'Private team', defaultTickets: 100 }]; snapshot.seasons = admin.seasons;
    const hierarchy = inventoryHierarchy(snapshot);
    expect(hierarchy.teams.map(t => t.name)).toEqual(['Synthetic Comets']);
    expect(hierarchy.seasons.map(s => s.id)).toEqual([GUID(3, 1)]);
    expect(inventoryTotals(snapshot.catalog).tickets).toBe(4);
  });
  it('date-window releases stay inside the current inventory', () => {
    const snapshot = provider().snapshot('coordinator');
    expect(scopedWindowIds(snapshot.catalog, [GUID(5, 1)], '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')).toEqual([GUID(5, 1)]);
    expect(() => scopedWindowIds(snapshot.catalog, [], '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')).toThrow('No events');
  });
  it('edits capacity and removes an unused event without deleting its underlying record', async () => {
    const p = provider(); const id = GUID(5, 3);
    await p.execute('coordinator', { type: 'editInventory', gameId: id, title: 'Edited event', kind: 'event', gameDate: '2026-12-21T02:00:00Z', tickets: 2, status: 'scheduled' });
    expect(p.snapshot('coordinator').catalog.find(g => g.id === id)?.availableTickets).toBe(2);
    await p.execute('coordinator', { type: 'removeInventory', gameId: id });
    expect(p.snapshot('coordinator').catalog.some(g => g.id === id)).toBe(false);
  });
  it('protects history and denies requester edits', async () => {
    const p = provider();
    await expect(p.execute('coordinator', { type: 'removeInventory', gameId: GUID(5, 1) })).rejects.toThrow('requests or allocations');
    await expect(p.execute('employee', { type: 'removeInventory', gameId: GUID(5, 3) })).rejects.toThrow();
    const before = p.snapshot('coordinator');
    await expect(p.execute('coordinator', { type: 'editInventory', gameId: GUID(5, 4), title: 'Past Demo Night', kind: 'game', seasonId: GUID(3, 1), gameDate: '2026-10-01T02:00:00Z', tickets: 0, status: 'completed' })).rejects.toThrow('allocation history');
    expect(p.snapshot('coordinator')).toEqual(before);
  });
  it('keeps manually ineligible active employees separate from disabled directory contacts', () => {
    const state = createFixtures();
    const employee = state.contacts.find(c => c.type === 'employee' && c.directoryActive)!;
    employee.appActive = false;
    const snapshot = new MockReviewProvider(() => Date.now(), undefined, state).snapshot('coordinator');
    expect(snapshot.contacts?.find(c => c.id === employee.id)?.directoryActive).toBe(true);
    expect(snapshot.options.some(c => c.id === employee.id)).toBe(false);
  });
});
