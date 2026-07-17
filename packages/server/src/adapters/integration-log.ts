import { db } from '../db/client.js';
import { integrationLogs } from '../db/schema.js';
import type { IntegrationAdapter, IntegrationStatus } from '@ais/shared';

interface LogInput {
  adapter: IntegrationAdapter;
  operation: string;
  status: IntegrationStatus;
  requestRef?: string;
  payload?: unknown;
  response?: unknown;
  error?: string;
  durationMs?: number;
}

export function logIntegration(input: LogInput): void {
  db.insert(integrationLogs)
    .values({
      adapter: input.adapter,
      operation: input.operation,
      status: input.status,
      requestRef: input.requestRef ?? null,
      payload: input.payload != null ? JSON.stringify(input.payload) : null,
      response: input.response != null ? JSON.stringify(input.response) : null,
      error: input.error ?? null,
      durationMs: input.durationMs ?? null,
      createdAt: Date.now(),
    })
    .run();
}
