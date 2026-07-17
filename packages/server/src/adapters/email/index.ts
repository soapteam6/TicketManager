import { env } from '../../env.js';
import type { EmailIntakeAdapter } from './adapter.js';
import { MockEmailIntakeAdapter } from './mock.js';

// Real 'graph' mode (Microsoft Graph / Outlook) would slot in here with the same interface.
export function getEmailIntakeAdapter(): EmailIntakeAdapter {
  switch (env.EMAIL_INTAKE_MODE) {
    case 'mock':
    default:
      return new MockEmailIntakeAdapter();
  }
}

export * from './adapter.js';
