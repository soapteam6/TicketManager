// Client-side view models for the records the server returns. These mirror the
// Drizzle row shapes (see packages/server/src/db/schema.ts) but are declared
// here so the client does not depend on server internals. Timestamps are
// unix-ms integers unless noted.
import type {
  GameStatus,
  SeasonStatus,
  SeatStatus,
  ContactType,
  ValueTier,
  RequestStatus,
  AssignmentStatus,
  WaitlistStatus,
  TicketStatus,
  FuturePriority,
  Role,
  FactorContribution,
} from '@ais/shared';

export interface Team {
  id: number;
  name: string;
  abbreviation: string;
  sport: string | null;
  venue: string | null;
  homeGamesPerSeason: number;
  defaultPlatform: string;
  officialUrl: string | null;
  defaultTicketsPerGame: number;
  isActive: number;
  createdAt: number;
}

export interface Season {
  id: number;
  teamId: number;
  label: string;
  startDate: number;
  endDate: number;
  status: SeasonStatus;
  createdAt: number;
}

export interface Game {
  id: number;
  seasonId: number;
  gameDate: number;
  opponent: string;
  promotions: string | null;
  notes: string | null;
  status: GameStatus;
  totalSeats: number;
  premiumScore: number;
  // Custom-event fields: kind 'game' (team game) or 'event' (title/description).
  title?: string | null;
  description?: string | null;
  kind?: 'game' | 'event';
  createdAt: number;
  // Enriched on GET /games (list) and GET /games/:id
  seasonLabel?: string | null;
  teamName?: string | null;
  teamId?: number | null;
}

export interface Seat {
  id: number;
  gameId: number;
  section: string;
  row: string;
  seatNumber: string;
  isAda: number;
  status: SeatStatus;
  createdAt: number;
}

export interface Contact {
  id: number;
  publicId: string;
  type: ContactType;
  fullName: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  accountOwnerUserId: number | null;
  valueTier: ValueTier;
  lifetimeBusinessGenerated: number;
  lastTicketDate: number | null;
  noShowCount: number;
  attendedCount: number;
  awardedCount: number;
  futurePriorityFlag: FuturePriority;
  notes: string | null;
  isActive: number;
  createdAt: number;
  updatedAt: number;
}

export interface TicketRequest {
  id: number;
  publicId: string;
  gameId: number;
  requesterUserId: number | null;
  requesterName: string | null;
  requesterCompany: string | null;
  requesterPhone: string | null;
  requesterEmail: string | null;
  beneficiaryContactId: number | null;
  beneficiaryType: ContactType;
  quantity: number;
  notes: string | null;
  salesOpportunityUsd: number;
  status: RequestStatus;
  priorityScore: number | null;
  priorityRank: number | null;
  scoringBreakdown: string | null;
  scoringConfigId: number | null;
  narrative: string | null;
  source: string;
  createdAt: number;
  updatedAt: number;
}

export interface Assignment {
  id: number;
  requestId: number;
  seatId: number;
  gameId: number;
  beneficiaryContactId: number | null;
  status: AssignmentStatus;
  assignedByUserId: number | null;
  approvedByUserId: number | null;
  approvedAt: number | null;
  transferRef: string | null;
  transferPlatform: string | null;
  transferredAt: number | null;
  createdAt: number;
  updatedAt: number;
  // Enriched on GET /assignments and GET /games/:id/assignments
  seatLabel?: string | null;
  requesterName?: string | null;
  quantity?: number | null;
}

export interface WaitlistEntry {
  id: number;
  gameId: number;
  requestId: number;
  position: number;
  status: WaitlistStatus;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AttendanceRecord {
  id: number;
  assignmentId: number;
  gameId: number;
  contactId: number | null;
  ticketStatus: TicketStatus;
  designation: ContactType;
  salesRepUserId: number | null;
  businessGenerated: number;
  followUpNotes: string | null;
  futurePriority: FuturePriority;
  recordedByUserId: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScoringConfig {
  id: number;
  name: string;
  isActive: number;
  version: number;
  weights: Record<string, number> | string;
  params: Record<string, number> | string;
  createdByUserId: number | null;
  createdAt: number;
}

export interface IntegrationLog {
  id: number;
  adapter: string;
  operation: string;
  status: string;
  requestRef: string | null;
  payload: string | null;
  response: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: number;
}

// --- Dashboard payloads ---
export interface DashboardOverview {
  teams: number;
  activeSeasons: number;
  upcomingGames: number;
  requestsByStatus: Record<string, number>;
  totalSeats: number;
  assignedSeats: number;
  transferredSeats: number;
}

export interface RemainingSeatsRow {
  gameId: number;
  opponent: string;
  gameDate: number;
  teamName: string;
  totalSeats: number;
  assignedCount: number;
  remaining: number;
}

export interface RoiRow {
  teamId: number;
  teamName: string;
  businessGenerated: number;
}

// A user role type re-export for local convenience.
export type { Role, FactorContribution };
