import { Router, type Request, type Response } from 'express';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { idParam } from '@ais/shared';
import { db } from '../db/client.js';
import {
  teams,
  seasons,
  games,
  seats,
  contacts,
  ticketRequests,
  assignments,
  attendanceRecords,
} from '../db/schema.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';

export const dashboardsRouter = Router();
dashboardsRouter.use(requireAuth);

const ACTIVE_ASSIGNMENT = ['proposed', 'approved', 'transferred'];
const UPCOMING_GAME_STATUS = ['scheduled', 'transfer_pending'];

dashboardsRouter.get('/overview', (_req: Request, res: Response) => {
  const now = Date.now();

  const teamCount = db.select({ c: sql<number>`count(*)` }).from(teams).get()?.c ?? 0;
  const activeSeasons =
    db.select({ c: sql<number>`count(*)` }).from(seasons).where(eq(seasons.status, 'active')).get()?.c ?? 0;
  const upcomingGames =
    db
      .select({ c: sql<number>`count(*)` })
      .from(games)
      .where(and(gte(games.gameDate, now), inArray(games.status, UPCOMING_GAME_STATUS)))
      .get()?.c ?? 0;

  const requestsByStatusRows = db
    .select({ status: ticketRequests.status, count: sql<number>`count(*)` })
    .from(ticketRequests)
    .groupBy(ticketRequests.status)
    .all();
  const requestsByStatus: Record<string, number> = {};
  for (const row of requestsByStatusRows) requestsByStatus[row.status] = row.count;

  const totalSeats = db.select({ c: sql<number>`count(*)` }).from(seats).get()?.c ?? 0;
  const assignedSeats =
    db
      .select({ c: sql<number>`count(*)` })
      .from(assignments)
      .where(inArray(assignments.status, ACTIVE_ASSIGNMENT))
      .get()?.c ?? 0;
  const transferredSeats =
    db
      .select({ c: sql<number>`count(*)` })
      .from(assignments)
      .where(eq(assignments.status, 'transferred'))
      .get()?.c ?? 0;

  res.json({
    teams: teamCount,
    activeSeasons,
    upcomingGames,
    requestsByStatus,
    totalSeats,
    assignedSeats,
    transferredSeats,
  });
});

dashboardsRouter.get('/remaining-seats', (_req: Request, res: Response) => {
  const now = Date.now();
  const rows = db
    .select({
      gameId: games.id,
      opponent: games.opponent,
      gameDate: games.gameDate,
      teamName: teams.name,
      totalSeats: games.totalSeats,
    })
    .from(games)
    .innerJoin(seasons, eq(games.seasonId, seasons.id))
    .innerJoin(teams, eq(seasons.teamId, teams.id))
    .where(and(gte(games.gameDate, now), inArray(games.status, UPCOMING_GAME_STATUS)))
    .orderBy(games.gameDate)
    .all();

  const result = rows.map((g) => {
    const assignedCount =
      db
        .select({ c: sql<number>`count(*)` })
        .from(assignments)
        .where(and(eq(assignments.gameId, g.gameId), inArray(assignments.status, ACTIVE_ASSIGNMENT)))
        .get()?.c ?? 0;
    return { ...g, assignedCount, remaining: g.totalSeats - assignedCount };
  });

  res.json({ games: result });
});

dashboardsRouter.get('/roi', (_req: Request, res: Response) => {
  const byTeam = db
    .select({
      teamId: teams.id,
      teamName: teams.name,
      businessGenerated: sql<number>`coalesce(sum(${attendanceRecords.businessGenerated}), 0)`,
    })
    .from(attendanceRecords)
    .innerJoin(assignments, eq(attendanceRecords.assignmentId, assignments.id))
    .innerJoin(games, eq(assignments.gameId, games.id))
    .innerJoin(seasons, eq(games.seasonId, seasons.id))
    .innerJoin(teams, eq(seasons.teamId, teams.id))
    .groupBy(teams.id, teams.name)
    .all();

  const total =
    db
      .select({ t: sql<number>`coalesce(sum(${attendanceRecords.businessGenerated}), 0)` })
      .from(attendanceRecords)
      .get()?.t ?? 0;

  res.json({ byTeam, total });
});

dashboardsRouter.get('/engagement', (_req: Request, res: Response) => {
  const rows = db
    .select({
      fullName: contacts.fullName,
      company: contacts.company,
      type: contacts.type,
      valueTier: contacts.valueTier,
      attendedCount: contacts.attendedCount,
      noShowCount: contacts.noShowCount,
      lifetimeBusinessGenerated: contacts.lifetimeBusinessGenerated,
      lastTicketDate: contacts.lastTicketDate,
      futurePriorityFlag: contacts.futurePriorityFlag,
    })
    .from(contacts)
    .orderBy(sql`${contacts.lifetimeBusinessGenerated} desc`)
    .limit(50)
    .all();
  res.json({ contacts: rows });
});

dashboardsRouter.get('/games/:id/utilization', validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };

  const totalSeats = db.select({ c: sql<number>`count(*)` }).from(seats).where(eq(seats.gameId, id)).get()?.c ?? 0;
  const assigned =
    db
      .select({ c: sql<number>`count(*)` })
      .from(assignments)
      .where(and(eq(assignments.gameId, id), inArray(assignments.status, ACTIVE_ASSIGNMENT)))
      .get()?.c ?? 0;
  const transferred =
    db
      .select({ c: sql<number>`count(*)` })
      .from(assignments)
      .where(and(eq(assignments.gameId, id), eq(assignments.status, 'transferred')))
      .get()?.c ?? 0;
  const attended =
    db
      .select({ c: sql<number>`count(*)` })
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.gameId, id), eq(attendanceRecords.ticketStatus, 'attended')))
      .get()?.c ?? 0;
  const noShow =
    db
      .select({ c: sql<number>`count(*)` })
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.gameId, id), eq(attendanceRecords.ticketStatus, 'no_show')))
      .get()?.c ?? 0;
  const declined =
    db
      .select({ c: sql<number>`count(*)` })
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.gameId, id), eq(attendanceRecords.ticketStatus, 'declined')))
      .get()?.c ?? 0;

  res.json({ utilization: { totalSeats, assigned, transferred, attended, noShow, declined } });
});
