import ExcelJS from 'exceljs';
import { Cr9cd_seasonsService } from '../generated/services/Cr9cd_seasonsService';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_ticketrequestsService } from '../generated/services/Cr9cd_ticketrequestsService';
import { Cr9cd_assignmentsService } from '../generated/services/Cr9cd_assignmentsService';
import { Cr9cd_attendancerecordsService } from '../generated/services/Cr9cd_attendancerecordsService';
import { requestStatusChoice, assignmentStatusChoice, ticketStatusChoice, contactTypeChoice, gameKindChoice } from '../dataverse/choiceMaps';

interface TrackerRow {
  gameDate: string;
  opponent: string;
  requester: string;
  beneficiaryType: string;
  quantity: number;
  seat: string;
  priorityScore: number | null;
  priorityRank: number | null;
  requestStatus: string;
  assignmentStatus: string;
  ticketStatus: string;
  businessGenerated: number;
  followUpNotes: string;
  isTransferred: boolean;
}

// Builds and downloads a "Season Tracker" workbook -- pure client-side generation (ExcelJS's
// in-memory writeBuffer() path never touches Node's fs, so it bundles fine for the sandboxed
// Code App runtime). No connector needed: this produces a disposable export, not an edit to an
// existing cloud workbook, so Excel Online is the wrong tool here regardless.
export async function exportSeasonTracker(seasonId: string): Promise<void> {
  const seasonResult = await Cr9cd_seasonsService.get(seasonId);
  const season = seasonResult.data;
  if (!season) throw new Error('Season not found');

  const gamesResult = await Cr9cd_gamesService.getAll({
    filter: `_cr9cd_season_value eq ${seasonId}`,
    orderBy: ['cr9cd_game_date asc'],
  });
  const games = gamesResult.data ?? [];

  const rows: TrackerRow[] = [];

  for (const game of games) {
    const isEvent = (game.cr9cd_kind != null ? gameKindChoice.toValue(game.cr9cd_kind) : 'game') === 'event';
    const opponentOrTitle = isEvent ? (game.cr9cd_title ?? '') : (game.cr9cd_opponent ?? '');
    const [requestsResult, assignmentsResult] = await Promise.all([
      Cr9cd_ticketrequestsService.getAll({ filter: `_cr9cd_game_value eq ${game.cr9cd_gameid}` }),
      Cr9cd_assignmentsService.getAll({ filter: `_cr9cd_game_value eq ${game.cr9cd_gameid}` }),
    ]);
    const requests = requestsResult.data ?? [];
    const assignments = assignmentsResult.data ?? [];
    const assignmentsByRequest = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const reqId = a._cr9cd_ticket_request_value;
      if (!reqId) continue;
      const list = assignmentsByRequest.get(reqId) ?? [];
      list.push(a);
      assignmentsByRequest.set(reqId, list);
    }

    const assignmentIds = assignments.map((a) => a.cr9cd_assignmentid);
    const attendanceById = new Map<string, { ticketStatus?: number; businessGenerated?: number; followUpNotes?: string }>();
    if (assignmentIds.length > 0) {
      const filter = assignmentIds.map((id) => `_cr9cd_assignment_value eq ${id}`).join(' or ');
      const attendanceResult = await Cr9cd_attendancerecordsService.getAll({ filter });
      for (const rec of attendanceResult.data ?? []) {
        const assignmentId = rec._cr9cd_assignment_value;
        if (assignmentId) {
          attendanceById.set(assignmentId, {
            ticketStatus: rec.cr9cd_ticket_status,
            businessGenerated: rec.cr9cd_business_generated,
            followUpNotes: rec.cr9cd_follow_up_notes,
          });
        }
      }
    }

    for (const request of requests) {
      const reqAssignments = assignmentsByRequest.get(request.cr9cd_ticketrequestid) ?? [];
      if (reqAssignments.length === 0) {
        rows.push({
          gameDate: game.cr9cd_game_date ?? '',
          opponent: opponentOrTitle,
          requester: request.cr9cd_requester_name ?? '',
          beneficiaryType: request.cr9cd_beneficiary_type != null ? contactTypeChoice.toValue(request.cr9cd_beneficiary_type) : '',
          quantity: request.cr9cd_quantity ?? 1,
          seat: '',
          priorityScore: request.cr9cd_priority_score ?? null,
          priorityRank: request.cr9cd_priority_rank ?? null,
          requestStatus: request.cr9cd_status != null ? requestStatusChoice.toValue(request.cr9cd_status) : 'submitted',
          assignmentStatus: '',
          ticketStatus: '',
          businessGenerated: 0,
          followUpNotes: '',
          isTransferred: false,
        });
        continue;
      }
      for (const assignment of reqAssignments) {
        const attendance = attendanceById.get(assignment.cr9cd_assignmentid);
        const assignmentStatus = assignment.cr9cd_status != null ? assignmentStatusChoice.toValue(assignment.cr9cd_status) : 'proposed';
        rows.push({
          gameDate: game.cr9cd_game_date ?? '',
          opponent: opponentOrTitle,
          requester: request.cr9cd_requester_name ?? '',
          beneficiaryType: request.cr9cd_beneficiary_type != null ? contactTypeChoice.toValue(request.cr9cd_beneficiary_type) : '',
          quantity: request.cr9cd_quantity ?? 1,
          seat: assignment.cr9cd_seatname ?? '',
          priorityScore: request.cr9cd_priority_score ?? null,
          priorityRank: request.cr9cd_priority_rank ?? null,
          requestStatus: request.cr9cd_status != null ? requestStatusChoice.toValue(request.cr9cd_status) : 'submitted',
          assignmentStatus,
          ticketStatus: attendance?.ticketStatus != null ? ticketStatusChoice.toValue(attendance.ticketStatus) : '',
          businessGenerated: attendance?.businessGenerated ?? 0,
          followUpNotes: attendance?.followUpNotes ?? '',
          isTransferred: assignmentStatus === 'transferred',
        });
      }
    }
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Season Tracker');
  sheet.columns = [
    { header: 'Game Date', key: 'gameDate', width: 12 },
    { header: 'Opponent', key: 'opponent', width: 20 },
    { header: 'Requester', key: 'requester', width: 22 },
    { header: 'Type', key: 'beneficiaryType', width: 10 },
    { header: 'Qty', key: 'quantity', width: 6 },
    { header: 'Seat', key: 'seat', width: 16 },
    { header: 'Priority Score', key: 'priorityScore', width: 12 },
    { header: 'Priority Rank', key: 'priorityRank', width: 12 },
    { header: 'Request Status', key: 'requestStatus', width: 16 },
    { header: 'Assignment Status', key: 'assignmentStatus', width: 16 },
    { header: 'Ticket Status', key: 'ticketStatus', width: 14 },
    { header: 'Business Generated', key: 'businessGenerated', width: 16 },
    { header: 'Follow-up Notes', key: 'followUpNotes', width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    const excelRow = sheet.addRow({
      ...row,
      gameDate: row.gameDate ? new Date(row.gameDate).toLocaleDateString() : '',
      priorityScore: row.priorityScore != null ? Number(row.priorityScore.toFixed(3)) : '',
      priorityRank: row.priorityRank ?? '',
    });
    if (row.isTransferred) {
      excelRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `season-tracker-${season.cr9cd_name ?? seasonId}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
