import type { TransferPlatform } from '@ais/shared';
import type { TicketTransferAdapter, TransferInput, TransferRecord } from './adapter.js';

// Simulates a transfer via Ticketmaster/AXS/SeatGeek: returns a fake confirmation ref.
// Real per-platform adapters implement this same interface; callers never change.
export class MockTransferAdapter implements TicketTransferAdapter {
  constructor(public readonly platform: TransferPlatform) {}

  async transfer(input: TransferInput): Promise<TransferRecord> {
    const externalRef = `${this.platform.toUpperCase()}-${input.assignmentId}-${input.gameId}`;
    return { status: 'transferred', platform: this.platform, externalRef };
  }
}
