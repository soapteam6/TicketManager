import { Cr9cd_assignmentsService } from '../generated/services/Cr9cd_assignmentsService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { assignmentStatusChoice, seatStatusChoice, gameStatusChoice, transferPlatformChoice } from '../dataverse/choiceMaps';
import { logIntegration } from './integrationLogService';
import type { TransferPlatform, AssignmentStatus } from '../domain/enums';

// Ticket transfer is 100% simulated in the original app too (no real Ticketmaster/AXS/SeatGeek
// integration exists) -- this ports the always-succeeds mock behavior as client-side logic.
async function transferOne(assignmentId: string, platform: TransferPlatform): Promise<string> {
  const started = Date.now();
  const result = await Cr9cd_assignmentsService.get(assignmentId);
  const assignment = result.data;
  if (!assignment) throw new Error('Assignment not found');

  const transferRef = `${platform.toUpperCase()}-${assignmentId.slice(0, 8)}-${assignment._cr9cd_game_value?.slice(0, 8) ?? 'game'}`;

  await Cr9cd_assignmentsService.update(assignmentId, {
    cr9cd_status: assignmentStatusChoice.toCode('transferred'),
    cr9cd_transfer_ref: transferRef,
    cr9cd_transfer_platform: transferPlatformChoice.toCode(platform),
    cr9cd_transferred_at: new Date().toISOString(),
  });

  const seatId = assignment._cr9cd_seat_value;
  if (seatId) {
    await Cr9cd_seatsService.update(seatId, { cr9cd_status: seatStatusChoice.toCode('transferred') });
  }

  await logIntegration({
    adapter: 'ticketing',
    operation: 'transfer',
    status: 'success',
    requestRef: assignmentId,
    response: { transferRef, platform },
    durationMs: Date.now() - started,
  });

  return transferRef;
}

// Bulk-transfers all approved assignments for a game (optionally filtered to specific assignment
// ids), then marks the game transfer_pending.
export async function transferGame(gameId: string, platform: TransferPlatform, assignmentIds?: string[]): Promise<number> {
  const approvableStatuses: AssignmentStatus[] = ['approved'];
  const statusFilter = approvableStatuses.map((s) => `cr9cd_status eq ${assignmentStatusChoice.toCode(s)}`).join(' or ');
  const result = await Cr9cd_assignmentsService.getAll({
    filter: `_cr9cd_game_value eq ${gameId} and (${statusFilter})`,
    select: ['cr9cd_assignmentid'],
  });
  const targets = (result.data ?? [])
    .map((a) => a.cr9cd_assignmentid)
    .filter((id) => !assignmentIds || assignmentIds.includes(id));

  for (const id of targets) {
    await transferOne(id, platform);
  }

  if (targets.length > 0) {
    await Cr9cd_gamesService.update(gameId, { cr9cd_status: gameStatusChoice.toCode('transfer_pending') });
  }

  return targets.length;
}
