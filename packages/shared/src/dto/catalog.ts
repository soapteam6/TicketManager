import { z } from 'zod';
import { SEASON_STATUS, GAME_STATUS } from '../enums.js';

// --- Seasons ---
export const createSeasonSchema = z.object({
  teamId: z.coerce.number().int().positive(),
  label: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  status: z.enum(SEASON_STATUS).optional(),
});
export type CreateSeasonInput = z.infer<typeof createSeasonSchema>;

export const updateSeasonSchema = createSeasonSchema.partial().omit({ teamId: true });
export type UpdateSeasonInput = z.infer<typeof updateSeasonSchema>;

// --- Games ---
export const createGameSchema = z.object({
  seasonId: z.coerce.number().int().positive(),
  gameDate: z.string().min(1),
  opponent: z.string().min(1),
  promotions: z.string().optional(),
  notes: z.string().optional(),
  premiumScore: z.coerce.number().min(0).max(1).optional(),
});
export type CreateGameInput = z.infer<typeof createGameSchema>;

export const updateGameSchema = z.object({
  gameDate: z.string().min(1).optional(),
  opponent: z.string().min(1).optional(),
  promotions: z.string().optional(),
  notes: z.string().optional(),
  premiumScore: z.coerce.number().min(0).max(1).optional(),
  status: z.enum(GAME_STATUS).optional(),
});
export type UpdateGameInput = z.infer<typeof updateGameSchema>;

// Schedule import: one row per game. Used by the schedule-import path (CSV/JSON paste).
export const importGamesSchema = z.object({
  games: z
    .array(
      z.object({
        gameDate: z.string().min(1),
        opponent: z.string().min(1),
        promotions: z.string().optional(),
        premiumScore: z.coerce.number().min(0).max(1).optional(),
      })
    )
    .min(1),
});
export type ImportGamesInput = z.infer<typeof importGamesSchema>;

// A custom event (not a team game): title, description, date, number of tickets.
export const createEventSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  date: z.string().min(1),
  tickets: z.coerce.number().int().min(0).optional(),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

// AI schedule import from a team's official website.
export const extractedGameSchema = z.object({
  gameDate: z.string().min(1),
  opponent: z.string().min(1),
  promotions: z.string().nullable().optional(),
});

export const scheduleImportSchema = z.object({
  url: z.string().url().optional(),
  // Paste-the-schedule path: raw text copied from the site, parsed by AI in one cheap call.
  pastedText: z.string().optional(),
  preview: z.boolean().optional(),
  seasonId: z.coerce.number().int().positive().optional(),
  ticketsPerGame: z.coerce.number().int().min(0).optional(),
  // Alternative to ticketsPerGame: a season total, spread evenly across the imported games.
  totalTickets: z.coerce.number().int().min(0).optional(),
  games: z.array(extractedGameSchema).optional(),
});
export type ScheduleImportInput = z.infer<typeof scheduleImportSchema>;

// --- Seats / inventory ---
export const bulkSeatsSchema = z.object({
  section: z.string().min(1),
  row: z.string().min(1),
  fromSeat: z.coerce.number().int().positive(),
  toSeat: z.coerce.number().int().positive(),
  isAda: z.boolean().optional(),
});
export type BulkSeatsInput = z.infer<typeof bulkSeatsSchema>;
