import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import { Cr9cd_ticketrequestsService } from '../generated/services/Cr9cd_ticketrequestsService';
import { Cr9cd_assignmentsService } from '../generated/services/Cr9cd_assignmentsService';
import { Cr9cd_waitlistentriesService } from '../generated/services/Cr9cd_waitlistentriesService';
import { Cr9cd_attendancerecordsService } from '../generated/services/Cr9cd_attendancerecordsService';

export interface GameDependentCounts {
  requests: number;
  assignments: number;
  seats: number;
  waitlistEntries: number;
  attendanceRecords: number;
}

export async function countGameDependents(gameId: string): Promise<GameDependentCounts> {
  const [requests, assignments, seats, waitlistEntries, attendanceRecords] = await Promise.all([
    Cr9cd_ticketrequestsService.getAll({ filter: `_cr9cd_game_value eq ${gameId}`, select: ['cr9cd_ticketrequestid'] }),
    Cr9cd_assignmentsService.getAll({ filter: `_cr9cd_game_value eq ${gameId}`, select: ['cr9cd_assignmentid'] }),
    Cr9cd_seatsService.getAll({ filter: `_cr9cd_game_value eq ${gameId}`, select: ['cr9cd_seatid'] }),
    Cr9cd_waitlistentriesService.getAll({ filter: `_cr9cd_game_value eq ${gameId}`, select: ['cr9cd_waitlistentryid'] }),
    Cr9cd_attendancerecordsService.getAll({ filter: `_cr9cd_game_value eq ${gameId}`, select: ['cr9cd_attendancerecordid'] }),
  ]);
  return {
    requests: requests.data?.length ?? 0,
    assignments: assignments.data?.length ?? 0,
    seats: seats.data?.length ?? 0,
    waitlistEntries: waitlistEntries.data?.length ?? 0,
    attendanceRecords: attendanceRecords.data?.length ?? 0,
  };
}

// Cascades through every table that holds a lookup back to this game, deepest-first, so referential
// integrity never blocks the game delete at the end.
export async function deleteGame(gameId: string): Promise<void> {
  const [attendance, waitlist, assignments, requests, seats] = await Promise.all([
    Cr9cd_attendancerecordsService.getAll({ filter: `_cr9cd_game_value eq ${gameId}`, select: ['cr9cd_attendancerecordid'] }),
    Cr9cd_waitlistentriesService.getAll({ filter: `_cr9cd_game_value eq ${gameId}`, select: ['cr9cd_waitlistentryid'] }),
    Cr9cd_assignmentsService.getAll({ filter: `_cr9cd_game_value eq ${gameId}`, select: ['cr9cd_assignmentid'] }),
    Cr9cd_ticketrequestsService.getAll({ filter: `_cr9cd_game_value eq ${gameId}`, select: ['cr9cd_ticketrequestid'] }),
    Cr9cd_seatsService.getAll({ filter: `_cr9cd_game_value eq ${gameId}`, select: ['cr9cd_seatid'] }),
  ]);

  for (const a of attendance.data ?? []) await Cr9cd_attendancerecordsService.delete(a.cr9cd_attendancerecordid);
  for (const w of waitlist.data ?? []) await Cr9cd_waitlistentriesService.delete(w.cr9cd_waitlistentryid);
  for (const a of assignments.data ?? []) await Cr9cd_assignmentsService.delete(a.cr9cd_assignmentid);
  for (const r of requests.data ?? []) await Cr9cd_ticketrequestsService.delete(r.cr9cd_ticketrequestid);
  for (const s of seats.data ?? []) await Cr9cd_seatsService.delete(s.cr9cd_seatid);

  await Cr9cd_gamesService.delete(gameId);
}
