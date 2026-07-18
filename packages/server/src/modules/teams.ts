import { Router, type Request, type Response } from 'express';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { idParam, scheduleImportSchema, createEventSchema } from '@ais/shared';
import { db } from '../db/client.js';
import { teams, seasons, games, seats } from '../db/schema.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { conflict, notFound, badRequest, isUniqueViolation } from '../lib/errors.js';
import { narrativeEnabled } from '../env.js';
import { extractScheduleFromText } from '../adapters/schedule/importer.js';
import { logIntegration } from '../adapters/integration-log.js';

// Teams are created with manual info (name/details typed by the admin). The official website is
// used later, on demand, to pull the schedule — team creation itself does not call AI.
const createTeamSchema = z.object({
  name: z.string().min(1),
  abbreviation: z.string().min(1).optional(),
  sport: z.string().optional(),
  venue: z.string().optional(),
  officialUrl: z.string().optional(),
  homeGamesPerSeason: z.coerce.number().int().min(0).optional(),
  defaultPlatform: z.string().min(1).optional().default('mock'),
  defaultTicketsPerGame: z.coerce.number().int().min(0).optional(),
});

const updateTeamSchema = z.object({
  name: z.string().min(1).optional(),
  abbreviation: z.string().min(1).optional(),
  sport: z.string().optional(),
  venue: z.string().optional(),
  homeGamesPerSeason: z.coerce.number().int().min(0).optional(),
  defaultPlatform: z.string().min(1).optional(),
  officialUrl: z.string().optional(),
  defaultTicketsPerGame: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const teamsRouter = Router();
teamsRouter.use(requireAuth);

teamsRouter.get('/', (_req: Request, res: Response) => {
  const rows = db.select().from(teams).all();
  res.json({ teams: rows });
});

teamsRouter.get('/:id', validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const team = db.select().from(teams).where(eq(teams.id, id)).get();
  if (!team) throw notFound('Team not found');
  const teamSeasons = db.select().from(seasons).where(eq(seasons.teamId, id)).all();
  res.json({ team, seasons: teamSeasons });
});

teamsRouter.post('/', requireRole('admin'), validate(createTeamSchema), (req: Request, res: Response) => {
  const input = req.body as z.infer<typeof createTeamSchema>;
  if (db.select().from(teams).where(eq(teams.name, input.name)).get()) throw conflict('Team name already in use');
  const team = db
    .insert(teams)
    .values({
      name: input.name,
      abbreviation: input.abbreviation ?? input.name.slice(0, 3).toUpperCase(),
      sport: input.sport ?? null,
      venue: input.venue ?? null,
      officialUrl: input.officialUrl || null,
      homeGamesPerSeason: input.homeGamesPerSeason ?? 0,
      defaultPlatform: input.defaultPlatform ?? 'mock',
      defaultTicketsPerGame: input.defaultTicketsPerGame ?? 0,
      isActive: 1,
      createdAt: Date.now(),
    })
    .returning()
    .get();
  res.status(201).json({ team });
});

teamsRouter.patch('/:id', requireRole('admin'), validate(idParam, 'params'), validate(updateTeamSchema), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const existing = db.select().from(teams).where(eq(teams.id, id)).get();
  if (!existing) throw notFound('Team not found');
  const input = req.body as z.infer<typeof updateTeamSchema>;
  if (input.name && input.name !== existing.name && db.select().from(teams).where(eq(teams.name, input.name)).get()) {
    throw conflict('Team name already in use');
  }
  const team = db
    .update(teams)
    .set({
      name: input.name ?? existing.name,
      abbreviation: input.abbreviation ?? existing.abbreviation,
      sport: input.sport === undefined ? existing.sport : input.sport,
      venue: input.venue === undefined ? existing.venue : input.venue,
      homeGamesPerSeason: input.homeGamesPerSeason ?? existing.homeGamesPerSeason,
      defaultPlatform: input.defaultPlatform ?? existing.defaultPlatform,
      officialUrl: input.officialUrl === undefined ? existing.officialUrl : input.officialUrl || null,
      defaultTicketsPerGame: input.defaultTicketsPerGame ?? existing.defaultTicketsPerGame,
      isActive: input.isActive === undefined ? existing.isActive : input.isActive ? 1 : 0,
    })
    .where(eq(teams.id, id))
    .returning()
    .get();
  res.json({ team });
});

teamsRouter.delete('/:id', requireRole('admin'), validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const existing = db.select().from(teams).where(eq(teams.id, id)).get();
  if (!existing) throw notFound('Team not found');
  // FK cascades remove the team's seasons, games, seats, requests, assignments, etc.
  db.delete(teams).where(eq(teams.id, id)).run();
  res.json({ ok: true });
});

// Find the team's active season, or create one (deriving dates from the given games).
function getOrCreateSeasonForTeam(teamId: number, gamesForDates?: Array<{ gameDate: string }>): typeof seasons.$inferSelect {
  const active = db.select().from(seasons).where(and(eq(seasons.teamId, teamId), eq(seasons.status, 'active'))).get();
  if (active) return active;
  const any = db.select().from(seasons).where(eq(seasons.teamId, teamId)).orderBy(desc(seasons.createdAt)).get();
  if (any) return any;

  const dates = (gamesForDates ?? []).map((g) => new Date(g.gameDate).getTime()).filter((n) => !Number.isNaN(n));
  const now = Date.now();
  const start = dates.length ? Math.min(...dates) : now;
  const end = dates.length ? Math.max(...dates) : now + 180 * 24 * 60 * 60 * 1000;
  const year = new Date(start).getFullYear();
  const label = `${year}-${String((year + 1) % 100).padStart(2, '0')} Season`;
  return db
    .insert(seasons)
    .values({ teamId, label, startDate: start, endDate: end, status: 'active', createdAt: now })
    .returning()
    .get();
}

// Create a block of generic "general admission" seats for a game.
function createGenericSeats(gameId: number, count: number): number {
  const now = Date.now();
  let created = 0;
  for (let n = 1; n <= count; n++) {
    try {
      db.insert(seats).values({ gameId, section: 'GA', row: 'GA', seatNumber: String(n), isAda: 0, status: 'available', createdAt: now }).run();
      created++;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  if (created > 0) {
    const total = db.select({ id: seats.id }).from(seats).where(eq(seats.gameId, gameId)).all().length;
    db.update(games).set({ totalSeats: total }).where(eq(games.id, gameId)).run();
  }
  return created;
}

// Manually add a single home game to a team (auto-creates a season if needed).
const addGameSchema = z.object({
  gameDate: z.string().min(1),
  opponent: z.string().min(1),
  promotions: z.string().optional(),
  tickets: z.coerce.number().int().min(0).optional(),
  premiumScore: z.coerce.number().min(0).max(1).optional(),
});

teamsRouter.post('/:id/games', requireRole('admin'), validate(idParam, 'params'), validate(addGameSchema), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const team = db.select().from(teams).where(eq(teams.id, id)).get();
  if (!team) throw notFound('Team not found');
  const input = req.body as z.infer<typeof addGameSchema>;
  const ms = new Date(input.gameDate).getTime();
  if (Number.isNaN(ms)) throw badRequest('Invalid game date/time');

  const season = getOrCreateSeasonForTeam(id, [{ gameDate: input.gameDate }]);
  const tickets = input.tickets ?? team.defaultTicketsPerGame ?? 0;
  try {
    const game = db
      .insert(games)
      .values({ seasonId: season.id, gameDate: ms, opponent: input.opponent, promotions: input.promotions ?? null, status: 'scheduled', totalSeats: 0, premiumScore: input.premiumScore ?? 0.5, createdAt: Date.now() })
      .returning()
      .get();
    let seatsCreated = 0;
    if (tickets > 0) seatsCreated += createGenericSeats(game.id, tickets);
    res.status(201).json({ game, seasonLabel: season.label, seatsCreated });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('That game already exists this season');
    throw err;
  }
});

// AI schedule import: browse the team's official site and (preview or) import its home schedule.
teamsRouter.post('/:id/schedule/import', requireRole('admin'), validate(idParam, 'params'), validate(scheduleImportSchema), async (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const team = db.select().from(teams).where(eq(teams.id, id)).get();
  if (!team) throw notFound('Team not found');
  const input = req.body as z.infer<typeof scheduleImportSchema>;

  const doImport = input.preview === false && !!input.seasonId && Array.isArray(input.games) && input.games.length > 0;

  if (!doImport) {
    // Preview: parse the pasted schedule text into structured games (one fast, low-cost call).
    if (!narrativeEnabled) throw badRequest('Schedule parsing requires ANTHROPIC_API_KEY to be set in .env');
    const text = input.pastedText?.trim();
    if (!text) throw badRequest('Paste the schedule text to parse, or add games manually');
    const started = Date.now();
    try {
      const extracted = await extractScheduleFromText(team.name, text);
      logIntegration({ adapter: 'schedule_import', operation: 'parse_text', status: 'success', requestRef: String(team.id), response: { count: extracted.length }, durationMs: Date.now() - started });
      res.json({ games: extracted, provider: 'claude', sourceUrl: 'pasted text' });
    } catch (err) {
      logIntegration({ adapter: 'schedule_import', operation: 'parse_text', status: 'error', requestRef: String(team.id), error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started });
      throw badRequest(`Schedule parsing failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // Import into the chosen season, or auto-create/find the team's season.
  const gameList = input.games!;
  const season = input.seasonId
    ? db.select().from(seasons).where(eq(seasons.id, input.seasonId)).get()
    : getOrCreateSeasonForTeam(id, gameList);
  if (!season || season.teamId !== id) throw badRequest('Season does not belong to this team');
  // Tickets per game: either a fixed per-game number, or a season total spread evenly (with the
  // remainder handed to the earliest games).
  const total = input.totalTickets ?? 0;
  const base = total > 0 ? Math.floor(total / gameList.length) : input.ticketsPerGame ?? team.defaultTicketsPerGame ?? 0;
  const remainder = total > 0 ? total % gameList.length : 0;

  const now = Date.now();
  let imported = 0;
  let skipped = 0;
  let seatsCreated = 0;

  for (let i = 0; i < gameList.length; i++) {
    const g = gameList[i];
    const ticketsForGame = base + (i < remainder ? 1 : 0);
    const ms = new Date(g.gameDate).getTime();
    if (Number.isNaN(ms)) {
      skipped++;
      continue;
    }
    try {
      const game = db
        .insert(games)
        .values({ seasonId: season.id, gameDate: ms, opponent: g.opponent, promotions: g.promotions ?? null, status: 'scheduled', totalSeats: 0, premiumScore: 0.5, createdAt: now })
        .returning()
        .get();
      imported++;
      if (ticketsForGame > 0) seatsCreated += createGenericSeats(game.id, ticketsForGame);
    } catch (err) {
      if (isUniqueViolation(err)) skipped++;
      else throw err;
    }
  }

  logIntegration({ adapter: 'schedule_import', operation: 'import', status: 'success', requestRef: String(season.id), response: { imported, skipped, seatsCreated } });
  res.json({ imported, skipped, seatsCreated, seasonLabel: season.label });
});

// --- CSV schedule template + upload (deterministic, no AI) ---
const CSV_HEADER = 'date,time,opponent,promotions,tickets';

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'team';
}

// Minimal CSV parser (quoted fields, doubled quotes; assumes no embedded newlines).
function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith('#'))
    .map((line) => {
      const out: string[] = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
          if (c === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
          } else cur += c;
        } else if (c === '"') inQ = true;
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out.map((v) => v.trim());
    });
}

// Combine a date cell (YYYY-MM-DD or M/D/YYYY) and optional time cell into a local unix-ms.
function parseCsvDateTime(dateStr: string, timeStr: string): number | null {
  let y: number, mo: number, da: number;
  let m = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) { y = +m[1]; mo = +m[2]; da = +m[3]; }
  else {
    m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    mo = +m[1]; da = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
  }
  let hh = 0, mm = 0;
  const t = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (t) {
    hh = +t[1]; mm = t[2] ? +t[2] : 0;
    const ap = t[3]?.toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
  }
  const d = new Date(y, mo - 1, da, hh, mm, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

teamsRouter.get('/:id/schedule/template.csv', requireRole('admin'), validate(idParam, 'params'), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const team = db.select().from(teams).where(eq(teams.id, id)).get();
  if (!team) throw notFound('Team not found');
  const d = team.defaultTicketsPerGame ?? 0;
  const csv = [
    CSV_HEADER,
    `2026-10-10,7:00 PM,Example Opponent A,Home Opener,${d}`,
    `2026-10-14,7:30 PM,Example Opponent B,,${d}`,
    `2026-10-21,7:00 PM,Example Opponent C,Theme Night,${d}`,
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${slug(team.name)}-schedule-template.csv"`);
  res.send(csv + '\n');
});

const csvImportSchema = z.object({ csv: z.string().min(1) });

teamsRouter.post('/:id/schedule/import-csv', requireRole('admin'), validate(idParam, 'params'), validate(csvImportSchema), (req: Request, res: Response) => {
  const { id } = req.params as unknown as { id: number };
  const team = db.select().from(teams).where(eq(teams.id, id)).get();
  if (!team) throw notFound('Team not found');

  const rows = parseCsv((req.body as { csv: string }).csv);
  if (rows.length === 0) throw badRequest('The CSV is empty');
  // Skip a header row if present.
  const startIdx = rows[0].join(',').toLowerCase().includes('opponent') ? 1 : 0;

  const parsed: Array<{ ms: number; opponent: string; promotions: string | null; tickets: number }> = [];
  const errors: string[] = [];
  for (let i = startIdx; i < rows.length; i++) {
    const [date = '', time = '', opponent = '', promotions = '', tickets = ''] = rows[i];
    if (!date && !opponent) continue;
    const ms = parseCsvDateTime(date, time);
    if (ms == null) { errors.push(`Row ${i + 1}: invalid date "${date}"`); continue; }
    if (!opponent) { errors.push(`Row ${i + 1}: missing opponent`); continue; }
    const t = tickets.trim() ? Math.max(0, parseInt(tickets, 10) || 0) : team.defaultTicketsPerGame ?? 0;
    parsed.push({ ms, opponent, promotions: promotions || null, tickets: t });
  }
  if (parsed.length === 0) throw badRequest(`No valid games in the CSV.${errors.length ? ' ' + errors.slice(0, 3).join('; ') : ''}`);

  const season = getOrCreateSeasonForTeam(id, parsed.map((p) => ({ gameDate: new Date(p.ms).toISOString() })));
  const now = Date.now();
  let imported = 0;
  let skipped = 0;
  let seatsCreated = 0;
  for (const p of parsed) {
    try {
      const game = db
        .insert(games)
        .values({ seasonId: season.id, gameDate: p.ms, opponent: p.opponent, promotions: p.promotions, status: 'scheduled', totalSeats: 0, premiumScore: 0.5, createdAt: now })
        .returning()
        .get();
      imported++;
      if (p.tickets > 0) seatsCreated += createGenericSeats(game.id, p.tickets);
    } catch (err) {
      if (isUniqueViolation(err)) skipped++;
      else throw err;
    }
  }

  logIntegration({ adapter: 'schedule_import', operation: 'import_csv', status: 'success', requestRef: String(season.id), response: { imported, skipped, seatsCreated } });
  res.json({ imported, skipped, seatsCreated, seasonLabel: season.label, errors });
});

// --- Custom events (title/description/date/tickets) — modelled as games in a built-in group ---
function getOrCreateCustomEventsTeam(): typeof teams.$inferSelect {
  const existing = db.select().from(teams).where(eq(teams.name, 'Custom Events')).get();
  if (existing) return existing;
  return db
    .insert(teams)
    .values({ name: 'Custom Events', abbreviation: 'EVT', sport: 'Custom Event', venue: null, defaultPlatform: 'mock', homeGamesPerSeason: 0, defaultTicketsPerGame: 0, isActive: 1, createdAt: Date.now() })
    .returning()
    .get();
}

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

eventsRouter.get('/', (_req: Request, res: Response) => {
  const rows = db.select().from(games).where(eq(games.kind, 'event')).orderBy(asc(games.gameDate)).all();
  res.json({ events: rows });
});

eventsRouter.post('/', requireRole('admin'), validate(createEventSchema), (req: Request, res: Response) => {
  const input = req.body as z.infer<typeof createEventSchema>;
  const ms = new Date(input.date).getTime();
  if (Number.isNaN(ms)) throw badRequest('Invalid event date/time');

  const team = getOrCreateCustomEventsTeam();
  const season = getOrCreateSeasonForTeam(team.id, [{ gameDate: input.date }]);
  const tickets = input.tickets ?? 0;
  const now = Date.now();
  const game = db
    .insert(games)
    .values({
      seasonId: season.id,
      gameDate: ms,
      opponent: input.title, // kept in sync with title for the unique index + legacy joins
      title: input.title,
      description: input.description ?? null,
      kind: 'event',
      status: 'scheduled',
      totalSeats: 0,
      premiumScore: 0.5,
      createdAt: now,
    })
    .returning()
    .get();
  let seatsCreated = 0;
  if (tickets > 0) seatsCreated += createGenericSeats(game.id, tickets);
  res.status(201).json({ game, seatsCreated });
});
