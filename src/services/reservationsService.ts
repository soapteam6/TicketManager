import { Cr9cd_reservationsService } from '../generated/services/Cr9cd_reservationsService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import type { Cr9cd_reservations } from '../generated/models/Cr9cd_reservationsModel';
import { bindRef, escapeODataString } from '../dataverse/bind';
import { reservationStatusChoice, seatStatusChoice } from '../dataverse/choiceMaps';
import { ACTIVE_RESERVATION_STATUSES } from '../domain/enums';

// Lazy auto-expiry: there is no cron, so every read/write path calls this to flip overdue 'offered'
// reservations to 'expired' and return their held seats to the available pool.
export async function expireDueReservations(gameId?: string): Promise<number> {
  const nowIso = new Date().toISOString();
  const scope = gameId ? `_cr9cd_game_value eq ${gameId} and ` : '';
  const result = await Cr9cd_reservationsService.getAll({
    filter: `${scope}cr9cd_status eq ${reservationStatusChoice.toCode('offered')} and cr9cd_expires_at lt ${nowIso}`,
  });
  let expired = 0;
  for (const r of result.data ?? []) {
    await Cr9cd_reservationsService.update(r.cr9cd_reservationid, { cr9cd_status: reservationStatusChoice.toCode('expired') });
    if (r._cr9cd_seat_value) {
      await Cr9cd_seatsService.update(r._cr9cd_seat_value, { cr9cd_status: seatStatusChoice.toCode('available') });
    }
    expired += 1;
  }
  return expired;
}

export async function listReservations(gameId: string): Promise<Cr9cd_reservations[]> {
  await expireDueReservations(gameId);
  const result = await Cr9cd_reservationsService.getAll({
    filter: `_cr9cd_game_value eq ${gameId}`,
    orderBy: ['createdon desc'],
  });
  return result.data ?? [];
}

export interface CreateReservationsInput {
  gameId: string;
  personName: string;
  personEmail?: string;
  quantity: number;
  ticketType?: string;
  expiresAt: string; // ISO datetime
}

// Offers up to `quantity` available seats (optionally of a given ticket type) to a named person.
// Each held seat becomes one 'offered' reservation and the seat flips to 'held' (removing it from the
// available pool). The seat-availability check is the single-active-hold guard.
export async function createReservations(input: CreateReservationsInput): Promise<number> {
  await expireDueReservations(input.gameId);
  const typeFilter = input.ticketType ? ` and cr9cd_ticket_type eq '${escapeODataString(input.ticketType)}'` : '';
  const seatsResult = await Cr9cd_seatsService.getAll({
    filter: `_cr9cd_game_value eq ${input.gameId} and cr9cd_status eq ${seatStatusChoice.toCode('available')}${typeFilter}`,
    orderBy: ['cr9cd_seat_number asc'],
  });
  const seats = (seatsResult.data ?? []).slice(0, Math.max(0, input.quantity));
  if (seats.length === 0) throw new Error('No available seats to reserve.');

  let created = 0;
  for (const seat of seats) {
    await Cr9cd_reservationsService.create({
      'cr9cd_Game@odata.bind': bindRef('cr9cd_games', input.gameId),
      'cr9cd_Seat@odata.bind': bindRef('cr9cd_seats', seat.cr9cd_seatid),
      cr9cd_name: input.personName,
      cr9cd_person_name: input.personName,
      cr9cd_person_email: input.personEmail,
      cr9cd_ticket_type: seat.cr9cd_ticket_type,
      cr9cd_status: reservationStatusChoice.toCode('offered'),
      cr9cd_expires_at: input.expiresAt,
    } as Parameters<typeof Cr9cd_reservationsService.create>[0]);
    await Cr9cd_seatsService.update(seat.cr9cd_seatid, { cr9cd_status: seatStatusChoice.toCode('held') });
    created += 1;
  }
  return created;
}

// Marks an offered reservation as claimed. Idempotent if already reserved; if the deadline has passed
// it expires instead (freeing the seat) and throws.
export async function claimReservation(reservationId: string): Promise<void> {
  const result = await Cr9cd_reservationsService.get(reservationId);
  const reservation = result.data;
  if (!reservation) throw new Error('Reservation not found');
  const status = reservation.cr9cd_status != null ? reservationStatusChoice.toValue(reservation.cr9cd_status) : 'offered';
  if (status === 'reserved') return;
  if (status !== 'offered') throw new Error('This reservation can no longer be claimed.');

  if (reservation.cr9cd_expires_at && new Date(reservation.cr9cd_expires_at).getTime() < Date.now()) {
    await Cr9cd_reservationsService.update(reservationId, { cr9cd_status: reservationStatusChoice.toCode('expired') });
    if (reservation._cr9cd_seat_value) {
      await Cr9cd_seatsService.update(reservation._cr9cd_seat_value, { cr9cd_status: seatStatusChoice.toCode('available') });
    }
    throw new Error('This offer has expired.');
  }

  await Cr9cd_reservationsService.update(reservationId, {
    cr9cd_status: reservationStatusChoice.toCode('reserved'),
    cr9cd_reserved_at: new Date().toISOString(),
  });
}

// Manually releases an active (offered/reserved) reservation, returning its seat to the pool.
export async function releaseReservation(reservationId: string): Promise<void> {
  const result = await Cr9cd_reservationsService.get(reservationId);
  const reservation = result.data;
  if (!reservation) throw new Error('Reservation not found');
  const status = reservation.cr9cd_status != null ? reservationStatusChoice.toValue(reservation.cr9cd_status) : 'offered';
  if (!ACTIVE_RESERVATION_STATUSES.includes(status)) return;

  await Cr9cd_reservationsService.update(reservationId, { cr9cd_status: reservationStatusChoice.toCode('released') });
  if (reservation._cr9cd_seat_value) {
    await Cr9cd_seatsService.update(reservation._cr9cd_seat_value, { cr9cd_status: seatStatusChoice.toCode('available') });
  }
}
