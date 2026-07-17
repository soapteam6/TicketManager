import type { ContactType } from '@ais/shared';

// A structured request parsed from an inbound message (real: Outlook via Graph; mock: pasted text).
export interface ParsedRequest {
  requesterName?: string;
  requesterEmail?: string;
  requesterCompany?: string;
  requesterPhone?: string;
  teamHint?: string;
  opponentOrDateHint?: string;
  quantity: number;
  beneficiaryType: ContactType;
  salesOpportunityUsd?: number;
  notes?: string;
  confidence: number; // 0..1
  needsReview: boolean;
  rawText: string;
}

export interface EmailIntakeAdapter {
  // Split a raw blob (one or more pasted emails) into individual messages.
  splitMessages(rawText: string): string[];
  parse(message: string): ParsedRequest;
}
