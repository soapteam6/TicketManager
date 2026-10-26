import { reviewErrorMessage } from './errorMessage';
import type { PlatformResponse, PlatformTransport } from './platformProvider';

function readConflict(error: unknown): boolean {
  return /rowversion|version of the existing record|workspace is changing|someone else updated the workspace/i.test(reviewErrorMessage(error));
}

// Only reads are retried. Concurrent subscribers share the same pending read,
// including React StrictMode's initial setup/cleanup/setup sequence.
export function createSnapshotLoader(transport: PlatformTransport, pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  let pending: Promise<PlatformResponse> | null = null;
  async function read(): Promise<PlatformResponse> {
    for (let attempt = 0; ; attempt++) {
      try { return await transport({ operation: 'snapshot' }); }
      catch (error) {
        if (attempt >= 2 || !readConflict(error)) throw error;
        await pause(150 * (attempt + 1));
      }
    }
  }
  return () => {
    if (!pending) pending = read().finally(() => { pending = null; });
    return pending;
  };
}

export function workspaceLoadMessage(error: unknown): string {
  const message = reviewErrorMessage(error);
  if (readConflict(error)) return 'The workspace changed while loading. Please try again.';
  if (/role.*required|permission|access denied|forbidden/i.test(message)) return 'Your account does not have access to this workspace. Ask your administrator to check your access.';
  if (/sign.?in|authentication|unauthorized|session.*expired/i.test(message)) return 'Your session needs attention. Sign in to Power Apps and try again.';
  return 'We couldn’t load your ticket data. Please try again.';
}
