import ExcelJS from 'exceljs';
import { Cr9cd_seasonsService } from '../generated/services/Cr9cd_seasonsService';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import type { Cr9cd_gamesBase } from '../generated/models/Cr9cd_gamesModel';
import { bindRef } from '../dataverse/bind';
import { gameKindChoice, gameStatusChoice, seatStatusChoice } from '../dataverse/choiceMaps';
import type { GameKind, GameStatus } from '../domain/enums';

const HEADERS = ['ID', 'Kind', 'Date', 'Opponent / Title', 'Promotions', 'Notes', 'Total Seats', 'Status'] as const;

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const KIND_LABELS: Record<GameKind, string> = { game: 'Game', event: 'Event' };
const STATUS_LABEL_TO_VALUE = new Map<string, GameStatus>(
  (['scheduled', 'transfer_pending', 'completed', 'cancelled'] as GameStatus[]).map((v) => [titleCase(v).toLowerCase(), v])
);

// Builds and downloads a schedule-only template (Date/Opponent-Title/Promotions/Notes/Seats/Status) for one
// season -- distinct from exportSeasonTracker, which reports on requests/assignments rather than raw schedule.
// Pre-fills from that season's existing games/events so the user can edit in place and re-import, or export
// a season with zero games to get a blank starting template.
export async function exportScheduleTemplate(seasonId: string): Promise<void> {
  const seasonResult = await Cr9cd_seasonsService.get(seasonId);
  const season = seasonResult.data;
  if (!season) throw new Error('Season not found');

  const gamesResult = await Cr9cd_gamesService.getAll({
    filter: `_cr9cd_season_value eq ${seasonId}`,
    orderBy: ['cr9cd_game_date asc'],
  });
  const games = gamesResult.data ?? [];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Schedule');
  sheet.columns = [
    { header: HEADERS[0], key: 'id', width: 4 },
    { header: HEADERS[1], key: 'kind', width: 10 },
    { header: HEADERS[2], key: 'date', width: 14 },
    { header: HEADERS[3], key: 'name', width: 26 },
    { header: HEADERS[4], key: 'promotions', width: 22 },
    { header: HEADERS[5], key: 'notes', width: 26 },
    { header: HEADERS[6], key: 'seats', width: 12 },
    { header: HEADERS[7], key: 'status', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn('id').hidden = true;

  for (const game of games) {
    const kind: GameKind = game.cr9cd_kind != null ? gameKindChoice.toValue(game.cr9cd_kind) : 'game';
    const status: GameStatus = game.cr9cd_status != null ? gameStatusChoice.toValue(game.cr9cd_status) : 'scheduled';
    sheet.addRow({
      id: game.cr9cd_gameid,
      kind: KIND_LABELS[kind],
      date: game.cr9cd_game_date ? new Date(game.cr9cd_game_date) : '',
      name: kind === 'event' ? (game.cr9cd_title ?? '') : (game.cr9cd_opponent ?? ''),
      promotions: game.cr9cd_promotions ?? '',
      notes: game.cr9cd_notes ?? '',
      seats: game.cr9cd_total_seats ?? '',
      status: titleCase(status),
    });
  }
  sheet.getColumn('date').numFmt = 'yyyy-mm-dd hh:mm';

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `schedule-template-${season.cr9cd_name ?? seasonId}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface ImportScheduleResult {
  created: number;
  updated: number;
  errors: string[];
}

// Re-imports a schedule template for a season: rows with a recognized ID (must belong to this season)
// update that game/event, rows with a blank ID create a new one. Never deletes -- rows removed from the
// sheet are simply left alone in Dataverse, so this can't be used to wipe a schedule by accident.
export async function importScheduleTemplate(seasonId: string, file: File): Promise<ImportScheduleResult> {
  const existingResult = await Cr9cd_gamesService.getAll({
    filter: `_cr9cd_season_value eq ${seasonId}`,
    select: ['cr9cd_gameid'],
  });
  const existingIds = new Set((existingResult.data ?? []).map((g) => g.cr9cd_gameid));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.getWorksheet('Schedule') ?? workbook.worksheets[0];
  if (!sheet) throw new Error('No worksheet found in file');

  const result: ImportScheduleResult = { created: 0, updated: 0, errors: [] };

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const rawId = row.getCell(1).value;
    const rawKind = row.getCell(2).value;
    const rawDate = row.getCell(3).value;
    const rawName = row.getCell(4).value;
    const rawPromotions = row.getCell(5).value;
    const rawNotes = row.getCell(6).value;
    const rawSeats = row.getCell(7).value;
    const rawStatus = row.getCell(8).value;

    const isBlankRow = [rawId, rawKind, rawDate, rawName, rawPromotions, rawNotes, rawSeats, rawStatus].every(
      (v) => v === null || v === undefined || v === ''
    );
    if (isBlankRow) continue;

    const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId).trim() : '';
    const name = typeof rawName === 'string' ? rawName.trim() : String(rawName ?? '').trim();
    const parsedDate = rawDate instanceof Date ? rawDate : rawDate ? new Date(String(rawDate)) : null;

    if (!name) {
      result.errors.push(`Row ${rowNumber}: missing Opponent / Title`);
      continue;
    }
    if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
      result.errors.push(`Row ${rowNumber}: invalid or missing Date`);
      continue;
    }
    if (id && !existingIds.has(id)) {
      result.errors.push(`Row ${rowNumber}: ID "${id}" does not belong to this season, skipped`);
      continue;
    }

    const kindLabel = typeof rawKind === 'string' ? rawKind.trim().toLowerCase() : '';
    const kind: GameKind = kindLabel.startsWith('event') ? 'event' : 'game';

    const statusLabel = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : '';
    const status: GameStatus = STATUS_LABEL_TO_VALUE.get(statusLabel) ?? 'scheduled';

    const seats = typeof rawSeats === 'number' ? rawSeats : rawSeats ? Number(rawSeats) : undefined;

    const fields: Partial<Omit<Cr9cd_gamesBase, 'cr9cd_gameid'>> = {
      cr9cd_kind: gameKindChoice.toCode(kind),
      cr9cd_game_date: parsedDate.toISOString(),
      cr9cd_opponent: kind === 'game' ? name : '',
      cr9cd_title: kind === 'event' ? name : '',
      cr9cd_promotions: typeof rawPromotions === 'string' ? rawPromotions : '',
      cr9cd_notes: typeof rawNotes === 'string' ? rawNotes : '',
      cr9cd_status: gameStatusChoice.toCode(status),
      ...(seats !== undefined && !Number.isNaN(seats) ? { cr9cd_total_seats: seats } : {}),
    };

    if (id) {
      await Cr9cd_gamesService.update(id, fields);
      result.updated++;
    } else {
      const created = await Cr9cd_gamesService.create({
        ...fields,
        'cr9cd_Season@odata.bind': bindRef('cr9cd_seasons', seasonId),
      } as Omit<Cr9cd_gamesBase, 'cr9cd_gameid'>);
      const gameId = created.data?.cr9cd_gameid;
      if (gameId && seats && seats > 0) {
        for (let i = 1; i <= seats; i++) {
          await Cr9cd_seatsService.create({
            'cr9cd_Game@odata.bind': bindRef('cr9cd_games', gameId),
            cr9cd_section: 'GA',
            cr9cd_row: '1',
            cr9cd_seat_number: String(i),
            cr9cd_status: seatStatusChoice.toCode('available'),
          } as Parameters<typeof Cr9cd_seatsService.create>[0]);
        }
      }
      result.created++;
    }
  }

  return result;
}
