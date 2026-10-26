import { describe, expect, it, vi } from 'vitest';
import { createSnapshotLoader, workspaceLoadMessage } from './workspaceLoading';
import type { PlatformResponse, PlatformTransport } from './platformProvider';

const result = { revision: 10 } as PlatformResponse;

describe('workspace startup reads', () => {
  it('shares a pending load across duplicate mount subscribers', async () => {
    let finish!: (response: PlatformResponse) => void;
    const transport = vi.fn<PlatformTransport>().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const load = createSnapshotLoader(transport);
    const first = load(), second = load();
    expect(first).toBe(second);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith({ operation: 'snapshot' });
    finish(result);
    expect(await second).toBe(result);
  });
  it('retries a read-only concurrency conflict without sending a mutation', async () => {
    const transport = vi.fn<PlatformTransport>().mockRejectedValueOnce(new Error('The version of the existing record does not match RowVersion.')).mockResolvedValueOnce(result);
    const pause = vi.fn().mockResolvedValue(undefined);
    expect(await createSnapshotLoader(transport, pause)()).toBe(result);
    expect(transport.mock.calls.map(([payload]) => payload)).toEqual([{ operation: 'snapshot' }, { operation: 'snapshot' }]);
    expect(pause).toHaveBeenCalledWith(150);
  });
  it('bounds concurrency retries and permits a later manual reload', async () => {
    const transport = vi.fn<PlatformTransport>().mockRejectedValue(new Error('The workspace is changing.'));
    const load = createSnapshotLoader(transport, vi.fn().mockResolvedValue(undefined));
    await expect(load()).rejects.toThrow('workspace is changing');
    expect(transport).toHaveBeenCalledTimes(3);
    transport.mockResolvedValueOnce(result);
    expect(await load()).toBe(result);
  });
  it('does not retry authentication or permission failures', async () => {
    for (const message of ['Authentication required', 'Coordinator permission is required']) {
      const transport = vi.fn<PlatformTransport>().mockRejectedValue(new Error(message));
      await expect(createSnapshotLoader(transport)()).rejects.toThrow(message);
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it('keeps platform implementation errors out of the loading screen', () => {
    expect(workspaceLoadMessage(new Error('Dataverse review could not complete. No partial changes were committed. The version of the existing record does not match RowVersion.')))
      .toBe('The workspace changed while loading. Please try again.');
    expect(workspaceLoadMessage(new Error('SQL transport stack exception'))).not.toContain('SQL');
    expect(workspaceLoadMessage(new Error('Coordinator permission is required'))).toContain('access');
  });
});
