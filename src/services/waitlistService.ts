import { Cr9cd_waitlistentriesService } from '../generated/services/Cr9cd_waitlistentriesService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import { Cr9cd_ticketrequestsService } from '../generated/services/Cr9cd_ticketrequestsService';
import { bindRef } from '../dataverse/bind';
import { waitlistStatusChoice, seatStatusChoice, requestStatusChoice } from '../dataverse/choiceMaps';
import { assignSeat } from './assignmentsService';

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
