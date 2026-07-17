import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Timestamps are unix-ms integers. Booleans are integer 0/1. JSON stored as text.

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  role: text('role').notNull(),
  isActive: integer('is_active').notNull().default(1),
  linkedContactId: integer('linked_contact_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const refreshTokens = sqliteTable('refresh_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
  createdAt: integer('created_at').notNull(),
});

export const teams = sqliteTable('teams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  abbreviation: text('abbreviation').notNull(),
  sport: text('sport'),
  venue: text('venue'),
  homeGamesPerSeason: integer('home_games_per_season').notNull().default(0),
  defaultPlatform: text('default_platform').notNull().default('mock'),
  officialUrl: text('official_url'),
  defaultTicketsPerGame: integer('default_tickets_per_game').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  createdAt: integer('created_at').notNull(),
});

export const seasons = sqliteTable(
  'seasons',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    startDate: integer('start_date').notNull(),
    endDate: integer('end_date').notNull(),
    status: text('status').notNull().default('draft'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({ uqTeamLabel: uniqueIndex('uq_season_team_label').on(t.teamId, t.label) })
);

export const games = sqliteTable(
  'games',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id').notNull().references(() => seasons.id, { onDelete: 'cascade' }),
    gameDate: integer('game_date').notNull(),
    opponent: text('opponent').notNull(),
    promotions: text('promotions'),
    notes: text('notes'),
    status: text('status').notNull().default('scheduled'),
    totalSeats: integer('total_seats').notNull().default(0),
    premiumScore: real('premium_score').notNull().default(0.5),
    // Custom-event fields: kind 'game' (team game) or 'event' (title/description).
    title: text('title'),
    description: text('description'),
    kind: text('kind').notNull().default('game'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    uqGame: uniqueIndex('uq_game_season_date_opp').on(t.seasonId, t.gameDate, t.opponent),
    bySeason: index('ix_game_season_date').on(t.seasonId, t.gameDate),
  })
);

export const seats = sqliteTable(
  'seats',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    gameId: integer('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
    section: text('section').notNull(),
    row: text('row').notNull(),
    seatNumber: text('seat_number').notNull(),
    isAda: integer('is_ada').notNull().default(0),
    status: text('status').notNull().default('available'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    uqSeat: uniqueIndex('uq_seat_identity').on(t.gameId, t.section, t.row, t.seatNumber),
    byGameStatus: index('ix_seat_game_status').on(t.gameId, t.status),
  })
);

export const contacts = sqliteTable('contacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  publicId: text('public_id').notNull().unique(),
  type: text('type').notNull(),
  fullName: text('full_name').notNull(),
  company: text('company'),
  email: text('email'),
  phone: text('phone'),
  title: text('title'),
  accountOwnerUserId: integer('account_owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  valueTier: text('value_tier').notNull().default('prospect'),
  lifetimeBusinessGenerated: real('lifetime_business_generated').notNull().default(0),
  lastTicketDate: integer('last_ticket_date'),
  noShowCount: integer('no_show_count').notNull().default(0),
  attendedCount: integer('attended_count').notNull().default(0),
  awardedCount: integer('awarded_count').notNull().default(0),
  futurePriorityFlag: text('future_priority_flag').notNull().default('normal'),
  notes: text('notes'),
  crmContactId: text('crm_contact_id'),
  crmAccountId: text('crm_account_id'),
  directoryUserId: text('directory_user_id'),
  isActive: integer('is_active').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const ticketRequests = sqliteTable(
  'ticket_requests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    publicId: text('public_id').notNull().unique(),
    gameId: integer('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
    requesterUserId: integer('requester_user_id').references(() => users.id, { onDelete: 'set null' }),
    requesterName: text('requester_name'),
    requesterCompany: text('requester_company'),
    requesterPhone: text('requester_phone'),
    requesterEmail: text('requester_email'),
    beneficiaryContactId: integer('beneficiary_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    beneficiaryType: text('beneficiary_type').notNull().default('customer'),
    quantity: integer('quantity').notNull(),
    notes: text('notes'),
    salesOpportunityUsd: real('sales_opportunity_usd').notNull().default(0),
    status: text('status').notNull().default('submitted'),
    priorityScore: real('priority_score'),
    priorityRank: integer('priority_rank'),
    scoringBreakdown: text('scoring_breakdown'),
    scoringConfigId: integer('scoring_config_id'),
    narrative: text('narrative'),
    source: text('source').notNull().default('manual'),
    crmOpportunityId: text('crm_opportunity_id'),
    crmOpportunityName: text('crm_opportunity_name'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({ byGameStatus: index('ix_request_game_status').on(t.gameId, t.status) })
);

// Multiple beneficiary contacts per request (all from the same company).
export const requestContacts = sqliteTable(
  'request_contacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    requestId: integer('request_id').notNull().references(() => ticketRequests.id, { onDelete: 'cascade' }),
    contactId: integer('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({ uq: uniqueIndex('uq_request_contact').on(t.requestId, t.contactId) })
);

export const assignments = sqliteTable(
  'assignments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    requestId: integer('request_id').notNull().references(() => ticketRequests.id, { onDelete: 'cascade' }),
    seatId: integer('seat_id').notNull().references(() => seats.id, { onDelete: 'cascade' }),
    gameId: integer('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
    beneficiaryContactId: integer('beneficiary_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('proposed'),
    assignedByUserId: integer('assigned_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: integer('approved_at'),
    transferRef: text('transfer_ref'),
    transferPlatform: text('transfer_platform'),
    transferredAt: integer('transferred_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({ byGameStatus: index('ix_assignment_game_status').on(t.gameId, t.status) })
);

export const waitlistEntries = sqliteTable(
  'waitlist_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    gameId: integer('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
    requestId: integer('request_id').notNull().references(() => ticketRequests.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    status: text('status').notNull().default('active'),
    reason: text('reason'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({ byGamePos: index('ix_waitlist_game_pos').on(t.gameId, t.position) })
);

export const attendanceRecords = sqliteTable('attendance_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  assignmentId: integer('assignment_id').notNull().unique().references(() => assignments.id, { onDelete: 'cascade' }),
  gameId: integer('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
  contactId: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  ticketStatus: text('ticket_status').notNull(),
  designation: text('designation').notNull(),
  salesRepUserId: integer('sales_rep_user_id').references(() => users.id, { onDelete: 'set null' }),
  businessGenerated: real('business_generated').notNull().default(0),
  followUpNotes: text('follow_up_notes'),
  futurePriority: text('future_priority').notNull().default('normal'),
  recordedByUserId: integer('recorded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const scoringConfigs = sqliteTable('scoring_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  isActive: integer('is_active').notNull().default(0),
  version: integer('version').notNull().default(1),
  weights: text('weights').notNull(),
  params: text('params').notNull(),
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
});

export const integrationLogs = sqliteTable(
  'integration_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    adapter: text('adapter').notNull(),
    operation: text('operation').notNull(),
    status: text('status').notNull(),
    requestRef: text('request_ref'),
    payload: text('payload'),
    response: text('response'),
    error: text('error'),
    durationMs: integer('duration_ms'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({ byAdapter: index('ix_intlog_adapter_created').on(t.adapter, t.createdAt) })
);

export const migrationsMeta = sqliteTable('_migrations', {
  id: text('id').primaryKey(),
  appliedAt: integer('applied_at').notNull(),
});

// Re-export for convenience
export const schema = {
  users,
  refreshTokens,
  teams,
  seasons,
  games,
  seats,
  contacts,
  ticketRequests,
  requestContacts,
  assignments,
  waitlistEntries,
  attendanceRecords,
  scoringConfigs,
  integrationLogs,
};

export { sql };
