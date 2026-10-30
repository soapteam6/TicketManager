import { describe, expect, it, vi } from 'vitest';
import { acceptsInterest, advancingServerTime, eventStatus, withEventActivity } from './eventActivity';
import { MockReviewProvider } from './provider';
import { DataverseReviewProvider } from './platformProvider';
import { createFixtures, GUID } from './fixtures';

const start = '2026-10-30T15:00:00Z';
const game = { status: 'scheduled' as const, gameDate: start };
describe('automatic event completion', () => {
  it('completes at the exact event instant and keeps cancelled events cancelled', () => {
    expect(eventStatus(game, Date.parse(start) - 1)).toBe('scheduled');
    expect(eventStatus(game, Date.parse(start))).toBe('completed');
    expect(acceptsInterest(game, Date.parse(start))).toBe(false);
    expect(eventStatus({ ...game, status: 'cancelled' }, Date.parse(start) + 1)).toBe('cancelled');
    expect(eventStatus({ ...game, gameDate: '2026-10-30T08:00:00-07:00' }, Date.parse(start))).toBe('completed');
  });
  it('moves past events to coordinator history without changing records or attendance', () => {
    const state = createFixtures(); state.games.find(g => g.id === GUID(5, 2))!.gameDate = start;
    const p = new MockReviewProvider(() => Date.parse(start) + 1, undefined, state);
    const snapshot = p.snapshot('coordinator'), before = structuredClone(snapshot);
    const result = withEventActivity(snapshot);
    expect(result.catalog.find(g => g.id === GUID(5, 2))?.status).toBe('completed');
    expect(result.catalog).toHaveLength(snapshot.catalog.length);
    expect(result.attendanceHistory).toEqual(snapshot.attendanceHistory);
    expect(snapshot).toEqual(before);
    expect(p.snapshot('employee').catalog).toEqual([]);
    expect(state.games.find(g => g.id === GUID(5, 2))!.status).toBe('scheduled');
  });
  it('rejects past interest for coordinators as well as requesters without changing data', async () => {
    const p = new MockReviewProvider(() => Date.parse('2027-01-01T00:00:00Z'));
    const before = p.snapshot('coordinator');
    await expect(p.execute('coordinator', { type: 'interest', gameId: GUID(5, 2), purpose: 'customer', contactIds: [GUID(4, 1)], quantity: 1, rationale: 'Late request' })).rejects.toThrow('no longer accepts');
    expect(p.snapshot('coordinator')).toEqual(before);
  });
  it('expires a loaded live event using elapsed server time even when the device clock is wrong', () => {
    const state = createFixtures(); const target = state.games.find(g => g.id === GUID(5, 2))!; target.gameDate = start;
    const serverNow = new Date(Date.parse(start) - 1000).toISOString();
    const snapshot = new MockReviewProvider(() => Date.parse(serverNow), undefined, state).snapshot('employee');
    const monotonic = vi.spyOn(performance, 'now').mockReturnValue(5000);
    const device = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2040-01-01T00:00:00Z'));
    try {
      const p = new DataverseReviewProvider(vi.fn(), { revision: 1, serverNow, snapshot: { ...snapshot, mode: 'dataverse' }, result: { message: '' } });
      expect(p.snapshot().catalog).toHaveLength(1);
      monotonic.mockReturnValue(6000);
      expect(p.snapshot().catalog).toHaveLength(0);
      expect(p.snapshot().serverNow).toBe('2026-10-30T15:00:00.000Z');
      expect(advancingServerTime(serverNow, 6000, 5000)).toBe(serverNow);
    } finally { monotonic.mockRestore(); device.mockRestore(); }
  });
});
