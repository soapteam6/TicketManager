import { Cr9cd_integrationlogsService } from '../generated/services/Cr9cd_integrationlogsService';
import { integrationAdapterChoice, integrationStatusChoice } from '../dataverse/choiceMaps';
import type { IntegrationAdapter, IntegrationStatus } from '../domain/enums';

export interface LogEntryInput {
  adapter: IntegrationAdapter;
  operation: string;
  status: IntegrationStatus;
  requestRef?: string;
  payload?: unknown;
  response?: unknown;
  error?: string;
  durationMs?: number;
}

// Generic audit-trail writer used by every external-integration call site (CRM, directory,
// ticketing transfer, schedule import). Never throws -- a logging failure must not break the
// operation it's describing.
export async function logIntegration(entry: LogEntryInput): Promise<void> {
  try {
    await Cr9cd_integrationlogsService.create({
      cr9cd_adapter: integrationAdapterChoice.toCode(entry.adapter),
      cr9cd_operation: entry.operation,
      cr9cd_status: integrationStatusChoice.toCode(entry.status),
      cr9cd_request_ref: entry.requestRef,
      cr9cd_payload: entry.payload !== undefined ? JSON.stringify(entry.payload) : undefined,
      cr9cd_response: entry.response !== undefined ? JSON.stringify(entry.response) : undefined,
      cr9cd_error: entry.error,
      cr9cd_duration_ms: entry.durationMs,
    } as Parameters<typeof Cr9cd_integrationlogsService.create>[0]);
  } catch {
    // Swallow -- logging is best-effort.
  }
}
