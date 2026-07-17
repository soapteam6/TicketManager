import { and, eq, inArray } from 'drizzle-orm';
import type { TransferPlatform } from '@ais/shared';
import { db } from '../db/client.js';
import { assignments, seats, games, seasons, teams, ticketRequests, contacts } from '../db/schema.js';
import { getTransferAdapter } from '../adapters/transfer/registry.js';
import { logIntegration } from '../adapters/integration-log.js';
import { seatLabel } from './assignments-service.js';
import { notFound, conflict } from '../lib/errors.js';

function platformForGame(gameId: number): TransferPlatform {
  const row = db
    .select({ platform: teams.defaultPlatform })
    .from(games)
    .innerJoin(seasons, eq(games.seasonId, seasons.id))
    .innerJoin(teams, eq(seasons.teamId, teams.id))
    .where(eq(games.id, gameId))
    .get();
  return (row?.platform as TransferPlatform) ?? 'mock';
}

async function transferOne(assignmentId: number): Promise<{ ok: boolean; ref?: string; error?: string }> {
  const a = db.select().from(assignments).where(eq(assignments.id, assignmentId)).get();
  if (!a) throw notFound('Assignment not found');
  if (a.status === 'transferred') return { ok: true, ref: a.transferRef ?? undefined };
  if (a.status !== 'approved') throw conflict('Only approved assignments can be transferred');

  const seat = db.select().from(seats).where(eq(seats.id, a.seatId)).get();
  const req = db.select().from(ticketRequests).where(eq(ticketRequests.id, a.requestId)).get();
  const contact = a.beneficiaryContactId
    ? db.select().from(contacts).where(eq(contacts.id, a.beneficiaryContactId)).get()
    : null;

  const platform = platformForGame(a.gameId);
  const adapter = getTransferAdapter(platform);
  const started = Date.now();
  try {
    const result = await adapter.transfer({
      assignmentId: a.id,
      gameId: String(a.gameId),
      requestRef: req?.publicId ?? String(a.requestId),
      recipientName: contact?.fullName ?? req?.requesterName ?? 'Recipient',
      recipientEmail: contact?.email ?? req?.requesterEmail ?? '',
      seatLabel: seat ? seatLabel(seat) : '',
    });

    if (result.status === 'transferred') {
      const now = Date.now();
      db.transaction(() => {
        db.update(assignments)
          .set({ status: 'transferred', transferRef: result.externalRef ?? null, transferPlatform: platform, transferredAt: now, updatedAt: now })
          .where(eq(assignments.id, a.id))
          .run();
        db.update(seats).set({ status: 'transferred' }).where(eq(seats.id, a.seatId)).run();
      });
      logIntegration({
        adapter: 'ticketing',
        operation: 'transfer',
        status: 'success',
        requestRef: req?.publicId,
        payload: { assignmentId: a.id, platform },
        response: { externalRef: result.externalRef },
        durationMs: Date.now() - started,
      });
      return { ok: true, ref: result.externalRef };
    }
    throw new Error(result.error ?? 'Transfer failed');
  } catch (err) {
    logIntegration({
      adapter: 'ticketing',
      operation: 'transfer',
      status: 'error',
      requestRef: req?.publicId,
      payload: { assignmentId: a.id, platform },
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function transferAssignment(assignmentId: number) {
  return transferOne(assignmentId);
}

// Bulk transfer (~1 week before the game). Optionally restrict to a subset of assignment ids.
export async function transferGame(gameId: number, assignmentIds?: number[]) {
  const conds = [eq(assignments.gameId, gameId), eq(assignments.status, 'approved')];
  const rows = db
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(...conds))
    .all()
    .filter((r) => !assignmentIds || assignmentIds.includes(r.id));

  const results = [];
  for (const r of rows) results.push({ assignmentId: r.id, ...(await transferOne(r.id)) });

  // Reflect transfer progress on the game.
  const remaining = db.select({ id: assignments.id }).from(assignments).where(and(eq(assignments.gameId, gameId), eq(assignments.status, 'approved'))).all();
  if (results.length > 0) {
    db.update(games).set({ status: remaining.length === 0 ? 'transfer_pending' : 'transfer_pending' }).where(eq(games.id, gameId)).run();
  }
  return { transferred: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
