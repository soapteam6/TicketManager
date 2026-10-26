import { describe, expect, it, vi } from 'vitest';
import { createFixtures, PERSONAS } from './fixtures';
import { MockReviewProvider } from './provider';
import { DataverseReviewProvider, type PlatformResponse, type PlatformTransport } from './platformProvider';

function response(key: 'coordinator' | 'employee' = 'coordinator'): PlatformResponse {
  const state = createFixtures();
  const snapshot = new MockReviewProvider(() => Date.parse('2026-10-26T12:00:00Z'), undefined, state).snapshot(key);
  snapshot.mode = 'dataverse';
  snapshot.persona = { ...PERSONAS[key], id: 'real-dataverse-user', name: 'Actual signed-in user' };
  return { revision: 7, serverNow: '2026-10-26T12:00:00Z', snapshot, ...(key === 'coordinator' ? { state } : {}), result: { message: 'Saved in Dataverse' } };
}

describe('Dataverse review boundary', () => {
  it('does not let an older in-flight read overwrite a completed save', async () => {
    let finishRead!: (value: PlatformResponse) => void;
    const saved = response();
    saved.revision = 8;
    saved.snapshot.catalog[0].title = 'Saved event';
    const transport = vi.fn<PlatformTransport>()
      .mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }))
      .mockResolvedValueOnce(saved);
    const provider = new DataverseReviewProvider(transport, response());
    const reload = provider.reload();
    await provider.execute('coordinator', { type: 'syncDirectory' });
    finishRead(response());
    await reload;
    expect(provider.snapshot().catalog[0].title).toBe('Saved event');
  });
  it('uses the server identity and never transmits a selectable persona', async () => {
    const transport = vi.fn<PlatformTransport>().mockResolvedValue(response());
    const provider = new DataverseReviewProvider(transport, response());
    await provider.execute('employee', { type: 'createTeam', name: 'QA', defaultTickets: 2 });
    const payload = transport.mock.calls[0][0];
    expect(payload).toMatchObject({ operation: 'command', revision: 7, command: { type: 'createTeam' } });
    expect(payload).not.toHaveProperty('persona');
    expect(payload).not.toHaveProperty('userId');
    expect(payload.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(provider.snapshot().persona.name).toBe('Actual signed-in user');
  });
  it('reconciles stale writes with a server refresh and preserves the failure', async () => {
    const transport = vi.fn<PlatformTransport>()
      .mockRejectedValueOnce(new Error('Stale revision'))
      .mockResolvedValueOnce({ ...response(), revision: 8 });
    const provider = new DataverseReviewProvider(transport, response());
    await expect(provider.execute('coordinator', { type: 'syncDirectory' })).rejects.toThrow('Stale revision');
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][0]).toEqual({ operation: 'snapshot' });
    expect(provider.snapshot().mode).toBe('dataverse');
  });
  it('does not expose coordinator scoring or tools to a server-projected requester', () => {
    const provider = new DataverseReviewProvider(vi.fn(), response('employee'));
    expect(provider.snapshot().contacts).toBeUndefined();
    expect(() => provider.rank('coordinator', createFixtures().games[0].id)).toThrow('Coordinator');
    expect(() => provider.previewSchedule('coordinator', '')).toThrow('Coordinator');
  });
  it('uses authoritative server time for the availability preview', () => {
    const initial = response();
    initial.serverNow = '2030-01-01T00:00:00Z';
    const provider = new DataverseReviewProvider(vi.fn(), initial);
    expect(provider.availability()).toContain('0 tickets available');
  });
  it('returns copies so UI mutations cannot alter persisted snapshots', () => {
    const provider = new DataverseReviewProvider(vi.fn(), response());
    provider.snapshot().catalog[0].title = 'Accidental UI mutation';
    expect(provider.snapshot().catalog[0].title).not.toBe('Accidental UI mutation');
  });
});
