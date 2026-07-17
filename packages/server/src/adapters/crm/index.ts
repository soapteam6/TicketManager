import { crmConfigured } from '../../env.js';
import type { CrmAdapter } from './adapter.js';
import { DynamicsCrmAdapter } from './dynamics.js';
import { MockCrmAdapter } from './mock.js';

let instance: CrmAdapter | null = null;

// Live Dynamics when the DYNAMICS_* env vars are set; otherwise sample data.
export function getCrmAdapter(): CrmAdapter {
  if (!instance) {
    instance = crmConfigured ? new DynamicsCrmAdapter() : new MockCrmAdapter();
  }
  return instance;
}

export * from './adapter.js';
