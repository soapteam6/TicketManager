import { Cr9cd_assignmentsService } from '../generated/services/Cr9cd_assignmentsService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import { bindRef } from '../dataverse/bind';
import { assignmentStatusChoice, seatStatusChoice } from '../dataverse/choiceMaps';
import type { AssignmentStatus } from '../domain/enums';
import { scoreGame } from './scoringService';
import { addToWaitlist, promoteWaitlist } from './waitlistService';

export interface AssignSeatParams {
  requestId: string;
  seatId: string;
  gameId: string;
  beneficiaryContactId: string | null;
}

export type AssignSeatResult = { status: 'assigned'; assignmentId: string } | { status: 'conflict' };

// Statuses that actively hold a seat -- mirrors ACTIVE_ASSIGNMENT_STATUSES from the original SQLite schema.
const ACTIVE_ASSIGNMENT_STATUSES: AssignmentStatus[] = ['proposed', 'approved', 'transferred'];

function activeStatusFilter(): string {
  return ACTIVE_ASSIGNMENT_STATUSES.map((s) => `cr9cd_status eq ${assignmentStatusChoice.toCode(s)}`).join(' or ');
}

async function activeAssignmentsForSeat(seatId: string) {
  const result = await Cr9cd_assignmentsService.getAll({
    filter: `_cr9cd_seat_value eq ${seatId} and (${activeStatusFilter()})`,
    orderBy: ['createdon asc'],
  });
  return result.data ?? [];
}

// Dataverse's generated update() has no conditional/If-Match option (checked directly against the
// generated Cr9cd_seatsService -- see memory-bank.md), so there is no true compare-and-swap available
// here. Instead: write optimistically, then immediately re-check for a concurrent duplicate and correct
// it (write-then-detect-then-reconcile), per the plan doc's documented fallback for this exact gap.
export async function assignSeat(params: AssignSeatParams): Promise<AssignSeatResult> {
  const seatResult = await Cr9cd_seatsService.get(params.seatId, { select: ['cr9cd_status'] });
  const seat = seatResult.data;
  if (!seat) throw new Error('Seat not found');
  const currentStatus = seat.cr9cd_status != null ? seatStatusChoice.toValue(seat.cr9cd_status) : 'available';
  if (currentStatus !== 'available' && currentStatus !== 'held') {
    return { status: 'conflict' };
  }

  await Cr9cd_seatsService.update(params.seatId, { cr9cd_status: seatStatusChoice.toCode('assigned') });

  const created = await Cr9cd_assignmentsService.create({
    'cr9cd_Ticket_Request@odata.bind': bindRef('cr9cd_ticketrequests', params.requestId),
    'cr9cd_Seat@odata.bind': bindRef('cr9cd_seats', params.seatId),
    'cr9cd_Game@odata.bind': bindRef('cr9cd_games', params.gameId),
    cr9cd_status: assignmentStatusChoice.toCode('proposed'),
    ...(params.beneficiaryContactId
      ? { 'cr9cd_Beneficiary_Contact@odata.bind': bindRef('cr9cd_contact_beneficiaries', params.beneficiaryContactId) }
      : {}),
  } as Parameters<typeof Cr9cd_assignmentsService.create>[0]);
  if (!created.data) throw new Error('Failed to create assignment');
  const assignmentId = created.data.cr9cd_assignmentid;

  const active = await activeAssignmentsForSeat(params.seatId);
  if (active.length > 1) {
    const [winner, ...losers] = active; // sorted by createdon asc -- earliest wins
    for (const loser of losers) {
      await Cr9cd_assignmentsService.update(loser.cr9cd_assignmentid, { cr9cd_status: assignmentStatusChoice.toCode('declined') });
      const loserRequestId = loser._cr9cd_ticket_request_value;
      if (loserRequestId) {
        await addToWaitlist(params.gameId, loserRequestId, 'Seat assignment conflict — reassign needed');
      }
    }
    if (winner.cr9cd_assignmentid !== assignmentId) {
      return { status: 'conflict' };
    }
  }

  return { status: 'assigned', assignmentId };
}

export interface AssignOutstandingParams {
  requestId: string;
  gameId: string;
  quantity: number;
  beneficiaryContactId: string | null;
  availableSeatIds: string[];
}

// One-click "assign the ticket(s)" for a request: grabs seats from inventory to cover the full
// outstanding quantity in one action instead of one click per seat. The seat is still an inventory
// row underneath (capacity/ADA/attendance tracking), but the operator never has to pick one --
// this just walks the available-seat list and calls assignSeat until the quantity is covered or
// inventory runs out.
export async function assignOutstandingTickets(params: AssignOutstandingParams): Promise<{ assigned: number }> {
  let assigned = 0;
  let cursor = 0;
  while (assigned < params.quantity && cursor < params.availableSeatIds.length) {
    const seatId = params.availableSeatIds[cursor++];
    const result = await assignSeat({
      requestId: params.requestId,
      seatId,
      gameId: params.gameId,
      beneficiaryContactId: params.beneficiaryContactId,
    });
    if (result.status === 'assigned') assigned++;
  }
  return { assigned };
}

export async function approveAssignment(assignmentId: string, approvedByUserId?: string): Promise<void> {
  await Cr9cd_assignmentsService.update(assignmentId, {
    cr9cd_status: assignmentStatusChoice.toCode('approved'),
    cr9cd_approved_at: new Date().toISOString(),
    ...(approvedByUserId ? { 'cr9cd_Approved_By@odata.bind': bindRef('systemusers', approvedByUserId) } : {}),
  });
}

export async function declineAssignment(assignmentId: string): Promise<void> {
  const result = await Cr9cd_assignmentsService.get(assignmentId);
  const assignment = result.data;
  if (!assignment) throw new Error('Assignment not found');

  await Cr9cd_assignmentsService.update(assignmentId, { cr9cd_status: assignmentStatusChoice.toCode('declined') });

  const seatId = assignment._cr9cd_seat_value;
  const gameId = assignment._cr9cd_game_value;
  if (seatId) {
    await Cr9cd_seatsService.update(seatId, { cr9cd_status: seatStatusChoice.toCode('available') });
  }
  if (gameId) {
    await promoteWaitlist(gameId);
  }
}

// Hard-delete for correcting an outright data-entry mistake (wrong seat/contact linked, duplicate,
// bad import row) -- unlike declineAssignment this removes the row entirely rather than keeping a
// declined history entry. Still frees the seat and promotes the waitlist like a decline would.
export async function deleteAssignment(assignmentId: string): Promise<void> {
  const result = await Cr9cd_assignmentsService.get(assignmentId);
  const assignment = result.data;
  if (!assignment) throw new Error('Assignment not found');

  const seatId = assignment._cr9cd_seat_value;
  const gameId = assignment._cr9cd_game_value;
  const status = assignment.cr9cd_status != null ? assignmentStatusChoice.toValue(assignment.cr9cd_status) : 'proposed';

  await Cr9cd_assignmentsService.delete(assignmentId);

  if (seatId && ACTIVE_ASSIGNMENT_STATUSES.includes(status)) {
    await Cr9cd_seatsService.update(seatId, { cr9cd_status: seatStatusChoice.toCode('available') });
  }
  if (gameId) {
    await promoteWaitlist(gameId);
  }
}

export async function reassignAssignment(assignmentId: string, newSeatId: string): Promise<AssignSeatResult> {
  const result = await Cr9cd_assignmentsService.get(assignmentId);
  const assignment = result.data;
  if (!assignment) throw new Error('Assignment not found');

  const newSeatResult = await Cr9cd_seatsService.get(newSeatId, { select: ['cr9cd_status'] });
  const newSeat = newSeatResult.data;
  if (!newSeat) throw new Error('Seat not found');
  const newSeatStatus = newSeat.cr9cd_status != null ? seatStatusChoice.toValue(newSeat.cr9cd_status) : 'available';
  if (newSeatStatus !== 'available' && newSeatStatus !== 'held') {
    return { status: 'conflict' };
  }

  const oldSeatId = assignment._cr9cd_seat_value;
  await Cr9cd_seatsService.update(newSeatId, { cr9cd_status: seatStatusChoice.toCode('assigned') });
  await Cr9cd_assignmentsService.update(assignmentId, {
    'cr9cd_Seat@odata.bind': bindRef('cr9cd_seats', newSeatId),
  });
  if (oldSeatId && oldSeatId !== newSeatId) {
    await Cr9cd_seatsService.update(oldSeatId, { cr9cd_status: seatStatusChoice.toCode('available') });
  }
  return { status: 'assigned', assignmentId };
}

// Scores the game, then greedily assigns available seats to award-recommended requests in rank
// order (splitting a multi-seat request across seats if needed), waitlisting everyone else.
export async function recommendForGame(gameId: string): Promise<{ awarded: number; waitlisted: number }> {
  const ranking = await scoreGame(gameId);

  const seatsResult = await Cr9cd_seatsService.getAll({
    filter: `_cr9cd_game_value eq ${gameId} and cr9cd_status eq ${seatStatusChoice.toCode('available')}`,
    select: ['cr9cd_seatid'],
    orderBy: ['cr9cd_section asc', 'cr9cd_row asc', 'cr9cd_seat_number asc'],
  });
  const availableSeatIds = (seatsResult.data ?? []).map((s) => s.cr9cd_seatid);
  let seatCursor = 0;
  let awarded = 0;
  let waitlisted = 0;

  for (const ranked of ranking.ranked) {
    if (ranked.recommendation !== 'award') {
      await addToWaitlist(gameId, ranked.requestId, 'Below cutline for available inventory');
      waitlisted++;
      continue;
    }

    let remainingQty = ranked.quantity;
    let anyAssigned = false;
    while (remainingQty > 0 && seatCursor < availableSeatIds.length) {
      const seatId = availableSeatIds[seatCursor++];
      const result = await assignSeat({
        requestId: ranked.requestId,
        seatId,
        gameId,
        beneficiaryContactId: ranked.contactId,
      });
      if (result.status === 'assigned') {
        anyAssigned = true;
        remainingQty--;
      }
    }

    if (remainingQty > 0) {
      await addToWaitlist(gameId, ranked.requestId, 'Insufficient seat inventory');
      waitlisted++;
    } else if (anyAssigned) {
      awarded++;
    }
  }

  return { awarded, waitlisted };
}

// Self-healing check for the one residual race window in the write-then-detect approach above: the
// seat write succeeds but the following assignment-create call fails, leaving an orphaned "assigned"
// seat with no live assignment. Run opportunistically (app load, before recommend/promote).
export async function reconcileOrphanSeats(gameId: string): Promise<number> {
  const heldStatuses = ['assigned', 'transferred'] as const;
  const filter = heldStatuses.map((s) => `cr9cd_status eq ${seatStatusChoice.toCode(s)}`).join(' or ');
  const seatsResult = await Cr9cd_seatsService.getAll({
    filter: `_cr9cd_game_value eq ${gameId} and (${filter})`,
    select: ['cr9cd_seatid'],
  });

  let reverted = 0;
  for (const seat of seatsResult.data ?? []) {
    const active = await activeAssignmentsForSeat(seat.cr9cd_seatid);
    if (active.length === 0) {
      await Cr9cd_seatsService.update(seat.cr9cd_seatid, { cr9cd_status: seatStatusChoice.toCode('available') });
      reverted++;
    }
  }
  return reverted;
}
