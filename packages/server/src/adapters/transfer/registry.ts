import { env } from '../../env.js';
import type { TransferPlatform } from '@ais/shared';
import type { TicketTransferAdapter } from './adapter.js';
import { MockTransferAdapter } from './mock.js';

// Routes a team's configured platform to its transfer adapter. Today everything is mocked;
// swap in TicketmasterTransferAdapter / AxsTransferAdapter / SeatGeekTransferAdapter later.
export function getTransferAdapter(teamPlatform: TransferPlatform): TicketTransferAdapter {
  if (env.TICKETING_PROVIDER === 'mock') {
    return new MockTransferAdapter(teamPlatform);
  }
  // Placeholder for real provider wiring.
  return new MockTransferAdapter(teamPlatform);
}

export * from './adapter.js';
