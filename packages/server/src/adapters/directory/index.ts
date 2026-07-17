import { crmConfigured, env } from '../../env.js';
import type { DirectoryAdapter } from './adapter.js';
import { GraphDirectoryAdapter } from './graph.js';
import { MockDirectoryAdapter } from './mock.js';

let instance: DirectoryAdapter | null = null;

// Uses the same app-registration credentials as Dynamics; live when they are present.
// DIRECTORY_PROVIDER can force 'graph' or 'mock' (default 'auto').
export function getDirectoryAdapter(): DirectoryAdapter {
  if (!instance) {
    const useGraph =
      env.DIRECTORY_PROVIDER === 'graph' || (env.DIRECTORY_PROVIDER === 'auto' && crmConfigured);
    instance = useGraph ? new GraphDirectoryAdapter() : new MockDirectoryAdapter();
  }
  return instance;
}

export * from './adapter.js';
