import type { TransferPlatform } from '@ais/shared';

export interface TransferInput {
  assignmentId: number;
  gameId: string;
  requestRef: string;
  recipientName: string;
  recipientEmail: string;
  seatLabel: string;
}

export interface TransferRecord {
  status: 'transferred' | 'failed';
  platform: TransferPlatform;
  externalRef?: string;
  error?: string;
}

export interface TicketTransferAdapter {
  readonly platform: TransferPlatform;
  transfer(input: TransferInput): Promise<TransferRecord>;
  // Real impls would add getStatus(externalRef) / revoke(externalRef).
}
