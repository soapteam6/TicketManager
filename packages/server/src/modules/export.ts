import { Router, type Request, type Response } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  teams,
  seasons,
  games,
  seats,
  contacts,
  users,
  ticketRequests,
  assignments,
  attendanceRecords,
} from '../db/schema.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { getExportAdapter, type SeasonTrackerRow } from '../adapters/export/index.js';

export const exportRouter = Router();
exportRouter.use(requireAuth);

const ACTIVE_ASSIGNMENT = ['proposed', 'approved', 'transferred'];

const exportQuery = z.object({
  seasonId: z.coerce.number().int().positive().optional(),
});

exportRouter.get('/season.xlsx', validate(exportQuery, 'query'), async (req: Request, res: Response) => {
  const { seasonId } = req.query as unknown as { seasonId?: number };

  const gameFilter = seasonId ? eq(games.seasonId, seasonId) : undefined;
  const gameRows = db
    .select({
      gameId: games.id,
      gameDate: games.gameDate,
      opponent: games.opponent,
      promotions: games.promotions,
      teamName: teams.name,
    })
    .from(games)
    .innerJoin(seasons, eq(games.seasonId, seasons.id))
    .innerJoin(teams, eq(seasons.teamId, teams.id))
    .where(gameFilter)
    .all();

  const rows: SeasonTrackerRow[] = [];

  for (const g of gameRows) {
    const requests = db.select().from(ticketRequests).where(eq(ticketRequests.gameId, g.gameId)).all();

    for (const request of requests) {
      // The active assignment (if any) for this request, with its seat.
      const assignmentRow = db
        .select({
          assignment: assignments,
          seat: seats,
        })
        .from(assignments)
        .leftJoin(seats, eq(assignments.seatId, seats.id))
        .where(and(eq(assignments.requestId, request.id), inArray(assignments.status, ACTIVE_ASSIGNMENT)))
        .get();

      const assignment = assignmentRow?.assignment ?? null;
      const seat = assignmentRow?.seat ?? null;

      const attendance = assignment
        ? db.select().from(attendanceRecords).where(eq(attendanceRecords.assignmentId, assignment.id)).get()
        : undefined;

      const salesRep =
        attendance?.salesRepUserId != null
          ? db.select().from(users).where(eq(users.id, attendance.salesRepUserId)).get()
          : undefined;

      const beneficiary =
        request.beneficiaryContactId != null
          ? db.select().from(contacts).where(eq(contacts.id, request.beneficiaryContactId)).get()
          : undefined;

      const seatLabel = seat ? `${seat.section} ${seat.row}-${seat.seatNumber}` : '';
      const requester = request.requesterName ?? beneficiary?.fullName ?? '';

      rows.push({
        team: g.teamName,
        gameDate: new Date(g.gameDate).toISOString().slice(0, 10),
        opponent: g.opponent,
        promotions: g.promotions ?? '',
        requesterName: requester,
        company: request.requesterCompany ?? beneficiary?.company ?? '',
        beneficiaryType: request.beneficiaryType,
        quantity: request.quantity,
        seatLabel,
        priorityScore: request.priorityScore ?? null,
        requestStatus: request.status,
        assignmentStatus: assignment?.status ?? '',
        attended: attendance?.ticketStatus ?? '',
        businessGenerated: attendance?.businessGenerated ?? null,
        salesRep: salesRep?.fullName ?? '',
        followUpNotes: attendance?.followUpNotes ?? '',
      });
    }
  }

  const buffer = await getExportAdapter().exportSeasonTracker('Season Tracker', rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="ais-season-tracker.xlsx"');
  res.send(buffer);
});
