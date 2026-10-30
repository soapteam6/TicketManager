import { describe, expect, it } from 'vitest';
import { attendanceDay, attendanceIsOpen } from './attendanceDay';
import { MockReviewProvider } from './provider';
import { createFixtures, GUID } from './fixtures';

describe('Pacific event-day attendance', () => {
  it.each([
    ['2026-07-16T02:00:00Z', '2026-07-15T07:00:00Z'],
    ['2026-12-16T03:00:00Z', '2026-12-15T08:00:00Z'],
    ['2026-03-09T02:00:00Z', '2026-03-08T08:00:00Z'],
    ['2026-11-02T03:00:00Z', '2026-11-01T07:00:00Z'],
  ])('opens at local midnight, including daylight-saving transition days: %s', (event, midnight) => {
    expect(attendanceIsOpen(event, Date.parse(midnight) - 1)).toBe(false);
    expect(attendanceIsOpen(event, midnight)).toBe(true);
    expect(attendanceIsOpen(event, Date.parse(event) + 86400000)).toBe(true);
  });
  it('compares Pacific dates rather than UTC dates or the device timezone', () => {
    expect(attendanceDay('2026-10-31T02:00:00Z')).toBe('2026-10-30');
    expect(attendanceIsOpen('2026-10-31T18:00:00Z', '2026-10-31T02:00:00Z')).toBe(false);
    expect(attendanceIsOpen('invalid', Date.now())).toBe(false);
  });
  it('saves same-day attendance before the event time and still requires evidence', async () => {
    const state = createFixtures();
    const allocation = state.allocations[0];
    state.games.find(g => g.id === allocation.gameId)!.gameDate = '2026-10-27T02:00:00Z';
    state.games.find(g => g.id === allocation.gameId)!.status = 'scheduled';
    const p = new MockReviewProvider(() => Date.parse('2026-10-26T07:00:00Z'), undefined, state);
    const command = { type: 'attendance' as const, assignmentId: allocation.id, outcome: 'attended' as const, evidence: 'Confirmed by coordinator' };
    await expect(p.execute('coordinator', { ...command, evidence: ' ' })).rejects.toThrow('evidence');
    await p.execute('coordinator', command);
    expect(p.snapshot('coordinator').allocations!.find(a => a.id === allocation.id)?.outcome).toBe('attended');
    expect(p.snapshot('coordinator').catalog.find(g => g.id === allocation.gameId)?.status).toBe('scheduled');
    expect(p.snapshot('coordinator').attendanceHistory!.at(-1)).toMatchObject({ assignmentId: allocation.id, outcome: 'attended' });
    // An edit to a later time today is valid; a later calendar day is not.
    const game = state.games.find(g => g.id === allocation.gameId)!;
    await p.execute('coordinator', { type: 'editInventory', gameId: game.id, kind: game.kind, seasonId: game.seasonId ?? undefined, title: game.title, gameDate: '2026-10-27T03:00:00Z', tickets: game.totalTickets, status: 'scheduled' });
    await expect(p.execute('coordinator', { type: 'editInventory', gameId: game.id, kind: game.kind, seasonId: game.seasonId ?? undefined, title: game.title, gameDate: '2026-10-28T03:00:00Z', tickets: game.totalTickets, status: 'scheduled' })).rejects.toThrow('beyond today');
    expect(p.snapshot('coordinator').catalog.find(g => g.id === GUID(5, 4))?.status).toBe('scheduled');
  });
});
