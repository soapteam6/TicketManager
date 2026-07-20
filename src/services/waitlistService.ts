import { Cr9cd_waitlistentriesService } from '../generated/services/Cr9cd_waitlistentriesService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import { Cr9cd_ticketrequestsService } from '../generated/services/Cr9cd_ticketrequestsService';
import { Cr9cd_assignmentsService } from '../generated/services/Cr9cd_assignmentsService';
import { bindRef } from '../dataverse/bind';
import { waitlistStatusChoice, seatStatusChoice, requestStatusChoice, assignmentStatusChoice } from '../dataverse/choiceMaps';
import type { AssignmentStatus } from '../domain/enums';
import { assignSeat } from './assignmentsService';

// Statuses that actively hold a seat -- mirrors ACTIVE_ASSIGNMENT_STATUSES elsewhere.
const ACTIVE_ASSIGNMENT_STATUSES: AssignmentStatus[] = ['proposed', 'approved', 'transferred'];

// Idempotent: returns the existing active entry's id if one already exists for this request/game.
export async function addToWaitlist(gameId: string, requestId: string, reason?: string): Promise<string> {
  const existing = await Cr9cd_waitlistentriesService.getAll({
    filter: `_cr9cd_game_value eq ${gameId} and _cr9cd_ticket_request_value eq ${requestId} and cr9cd_status eq ${waitlistStatusChoice.toCode('active')}`,
    select: ['cr9cd_waitlistentryid'],
    top: 1,
  });
  const already = existing.data?.[0];
  if (already) return already.cr9cd_waitlistentryid;

  const tail = await Cr9cd_waitlistentriesService.getAll({
    filter: `_cr9cd_game_value eq ${gameId} and cr9cd_status eq ${waitlistStatusChoice.toCode('active')}`,
    select: ['cr9cd_position'],
    orderBy: ['cr9cd_position desc'],
    top: 1,
  });
  const nextPosition = (tail.data?.[0]?.cr9cd_position ?? 0) + 1;

  const created = await Cr9cd_waitlistentriesService.create({
    'cr9cd_Game@odata.bind': bindRef('cr9cd_games', gameId),
    'cr9cd_Ticket_Request@odata.bind': bindRef('cr9cd_ticketrequests', requestId),
    cr9cd_position: nextPosition,
    cr9cd_status: waitlistStatusChoice.toCode('active'),
    cr9cd_reason: reason,
  } as Parameters<typeof Cr9cd_waitlistentriesService.create>[0]);
  if (!created.data) throw new Error('Failed to create waitlist entry');

  await Cr9cd_ticketrequestsService.update(requestId, { cr9cd_status: requestStatusChoice.toCode('waitlisted') });
  return created.data.cr9cd_waitlistentryid;
}

// Moves a request onto the waitlist: cancels its active assignments and returns their held seats to
// the pool, then queues the request. Unlike a decline, this does NOT auto-promote the queue -- the
// operator is deliberately parking this request, and the freed seats stay available for a later pass.
export async function moveRequestToWaitlist(gameId: string, requestId: string, reason?: string): Promise<string> {
  const activeFilter = ACTIVE_ASSIGNMENT_STATUSES.map((s) => `cr9cd_status eq ${assignmentStatusChoice.toCode(s)}`).join(' or ');
  const assignmentsResult = await Cr9cd_assignmentsService.getAll({
    filter: `_cr9cd_ticket_request_value eq ${requestId} and (${activeFilter})`,
    select: ['cr9cd_assignmentid', '_cr9cd_seat_value'],
  });
  for (const a of assignmentsResult.data ?? []) {
    await Cr9cd_assignmentsService.update(a.cr9cd_assignmentid, { cr9cd_status: assignmentStatusChoice.toCode('cancelled') });
    const seatId = a._cr9cd_seat_value;
    if (seatId) {
      await Cr9cd_seatsService.update(seatId, { cr9cd_status: seatStatusChoice.toCode('available') });
    }
  }
  return addToWaitlist(gameId, requestId, reason);
}

// Restores a single waitlist entry back to an open request: cancels the entry and returns the request
// to 'scored' (if it still carries a priority score) or 'submitted' so it can be re-processed.
export async function restoreFromWaitlist(entryId: string): Promise<void> {
  const entryResult = await Cr9cd_waitlistentriesService.get(entryId);
  const entry = entryResult.data;
  if (!entry) throw new Error('Waitlist entry not found');

  await Cr9cd_waitlistentriesService.update(entryId, { cr9cd_status: waitlistStatusChoice.toCode('cancelled') });

  const requestId = entry._cr9cd_ticket_request_value;
  if (requestId) {
    const requestResult = await Cr9cd_ticketrequestsService.get(requestId, { select: ['cr9cd_priority_score'] });
    const hadScore = requestResult.data?.cr9cd_priority_score != null;
    await Cr9cd_ticketrequestsService.update(requestId, {
      cr9cd_status: requestStatusChoice.toCode(hadScore ? 'scored' : 'submitted'),
    });
  }
}

// Walks the active queue in position order, filling outstanding need from newly-available seats.
// Called whenever a seat frees up (decline, cancellation).
export async function promoteWaitlist(gameId: string): Promise<number> {
  const activeResult = await Cr9cd_waitlistentriesService.getAll({
    filter: `_cr9cd_game_value eq ${gameId} and cr9cd_status eq ${waitlistStatusChoice.toCode('active')}`,
    orderBy: ['cr9cd_position asc'],
  });
  const entries = activeResult.data ?? [];

  let promoted = 0;
  for (const entry of entries) {
    const seatResult = await Cr9cd_seatsService.getAll({
      filter: `_cr9cd_game_value eq ${gameId} and cr9cd_status eq ${seatStatusChoice.toCode('available')}`,
      select: ['cr9cd_seatid'],
      top: 1,
    });
    const seat = seatResult.data?.[0];
    if (!seat) break; // no more inventory to promote into

    const requestId = entry._cr9cd_ticket_request_value;
    if (!requestId) continue;
    const requestResult = await Cr9cd_ticketrequestsService.get(requestId);
    const request = requestResult.data;
    if (!request) continue;

    const result = await assignSeat({
      requestId,
      seatId: seat.cr9cd_seatid,
      gameId,
      beneficiaryContactId: request._cr9cd_beneficiary_contact_value ?? null,
    });
    if (result.status === 'assigned') {
      await Cr9cd_waitlistentriesService.update(entry.cr9cd_waitlistentryid, { cr9cd_status: waitlistStatusChoice.toCode('promoted') });
      await Cr9cd_ticketrequestsService.update(requestId, { cr9cd_status: requestStatusChoice.toCode('approved') });
      promoted++;
    }
  }
  return promoted;
}
