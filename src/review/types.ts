import type { Cr9cd_games } from '../generated/models/Cr9cd_gamesModel';
import type { Cr9cd_contact_beneficiaries } from '../generated/models/Cr9cd_contact_beneficiariesModel';
import type { Cr9cd_ticketrequests } from '../generated/models/Cr9cd_ticketrequestsModel';
import type { Cr9cd_assignments } from '../generated/models/Cr9cd_assignmentsModel';
import type { GameRankingResult } from '../domain/scoring-types';
import type { ContactType, ValueTier, FactorKey } from '../domain/enums';

// View models are deliberately separate from generated Dataverse rows. Review-only fields
// below require an explicit future platform contract, never guessed SDK column names.
export type GameId = Cr9cd_games['cr9cd_gameid'];
export type ContactId =
  Cr9cd_contact_beneficiaries['cr9cd_contact_beneficiaryid'];
export type RequestId = Cr9cd_ticketrequests['cr9cd_ticketrequestid'];
export type AssignmentId = Cr9cd_assignments['cr9cd_assignmentid'];
export type PersonaKey = 'coordinator' | 'rep' | 'employee';
export interface Persona {
  key: PersonaKey;
  id: string;
  name: string;
  email: string;
  role: 'coordinator' | 'requester';
  directoryId?: string;
  isAppAdmin?: boolean;
}
export type AppRole = 'coordinator' | 'rep' | 'employee';
export interface AccessUser {
  id: string;
  name: string;
  email: string;
  isAppAdmin: boolean;
  directRoles: AppRole[];
  inheritedRoles: AppRole[];
  effectiveRole: AppRole | 'none';
}
export interface AccessGroup {
  id: string;
  directoryId: string;
  name: string;
  type: 'security' | 'microsoft365';
  membership: 'membersAndGuests' | 'members' | 'owners' | 'guests';
  roles: AppRole[];
}
export interface Team {
  id: string;
  name: string;
  defaultTickets: number;
}
export interface Season {
  id: string;
  teamId: string;
  label: string;
  startDate: string;
  endDate: string;
}
export interface Inventory {
  id: GameId;
  kind: 'game' | 'event';
  title: string;
  seasonId: string | null;
  gameDate: string;
  totalTickets: number;
  status: 'scheduled' | 'completed' | 'cancelled';
  release: 'private' | 'released' | 'scheduled';
  releaseAt: string | null;
}
export interface Seat {
  id: string;
  gameId: GameId;
  label: string;
  status: 'available' | 'assigned' | 'transferred';
}
export interface Contact {
  id: ContactId;
  type: ContactType;
  name: string;
  company: string;
  email: string;
  phone: string;
  tier: ValueTier;
  appActive: boolean;
  directoryActive: boolean;
  directoryId: string | null;
}
export interface Interest {
  id: RequestId;
  gameId: GameId;
  requesterId: string;
  recordedBy: string;
  purpose: ContactType;
  contactIds: ContactId[];
  quantity: number;
  rationale: string;
  opportunity: string;
  status:
    | 'submitted'
    | 'waitlisted'
    | 'partially_fulfilled'
    | 'fulfilled'
    | 'cancelled';
  createdAt: string;
}
export type ReviewOutcome = 'unknown' | 'attended' | 'no_show';
export interface Allocation {
  id: AssignmentId;
  requestId: RequestId;
  gameId: GameId;
  seatId: string;
  contactId: ContactId;
  status: 'approved' | 'transferred' | 'cancelled';
  decision: string;
  decidedBy: string;
  transferReference: string;
  outcome: ReviewOutcome;
  evidence: string;
}
export interface AttendanceChange {
  assignmentId: AssignmentId;
  outcome: ReviewOutcome;
  evidence: string;
  recordedAt: string;
  recordedBy: string;
}
export interface OutboxItem {
  id: string;
  kind: 'availability' | 'followup';
  subject: string;
  body: string;
  audience: string;
  createdAt: string;
}
export interface FollowupTemplate {
  enabled: boolean;
  subject: string;
  body: string;
}
export interface ScoreSettings {
  weights: Record<FactorKey, number>;
  category: { customer: number; prospect: number; employee: number };
}
export interface ReviewState {
  teams: Team[];
  seasons: Season[];
  games: Inventory[];
  seats: Seat[];
  contacts: Contact[];
  requests: Interest[];
  allocations: Allocation[];
  attendanceHistory: AttendanceChange[];
  outbox: OutboxItem[];
  followup: FollowupTemplate;
  scoring: ScoreSettings;
}
export interface DirectoryEntry {
  id: string;
  name: string;
  email: string;
  phone: string;
  active: boolean;
}
export interface DirectorySource {
  readSnapshot(): Promise<DirectoryEntry[]>;
}
export interface Demand {
  requestCount: number;
  requestingPeople: number;
  requestedTickets: number;
}
export interface InventoryView extends Inventory, Demand {
  availableTickets: number;
  released: boolean;
  seasonLabel?: string;
}
export interface ContactOption {
  id: ContactId;
  type: ContactType;
  name: string;
  company: string;
  email: string;
  phone: string;
}
export interface InterestView {
  id: RequestId;
  gameId: GameId;
  quantity: number;
  purpose: ContactType;
  rationale: string;
  opportunity: string;
  status: Interest['status'];
  contactNames: string;
  allocated: number;
  createdAt: string;
  contactIds?: ContactId[];
  requesterId?: string;
  requesterName?: string;
  requesterEmail?: string;
  recordedById?: string;
  recordedByName?: string;
  confirmedNoShows?: number;
}
export interface ReviewSnapshot {
  mode: 'mock' | 'dataverse' | 'platform-unavailable';
  persona: Persona;
  catalog: InventoryView[];
  requests: InterestView[];
  options: ContactOption[];
  teams: Team[];
  seasons: Season[];
  contacts?: Contact[];
  allocations?: Allocation[];
  attendanceHistory?: AttendanceChange[];
  outbox?: OutboxItem[];
  followup?: FollowupTemplate;
  scoring?: ScoreSettings;
  requesters?: { id: string; name: string; email?: string }[];
  accessUsers?: AccessUser[];
  accessGroups?: AccessGroup[];
}
export interface ScheduleRow {
  gameDate: string;
  title: string;
  tickets: number;
  kind: 'game' | 'event';
}
export interface SchedulePreview {
  rows: ScheduleRow[];
  errors: string[];
  timezone: 'UTC';
  published: false;
}
export type ReleaseCommand = {
  type: 'release';
  ids?: GameId[];
  from?: string;
  through?: string;
  action: Inventory['release'];
  at?: string;
};
export type ReviewCommand =
  | { type: 'setUserRole'; userId: string; role: AppRole | 'none'; expectedDirectRoles: AppRole[] }
  | { type: 'setGroupRole'; groupId: string; role: AppRole | 'none'; expectedRoles: AppRole[] }
  | { type: 'connectGroup'; directoryId: string; role: AppRole }
  | { type: 'createTeam'; name: string; defaultTickets: number }
  | {
      type: 'createSeason';
      teamId: string;
      label: string;
      startDate: string;
      endDate: string;
    }
  | {
      type: 'createInventory';
      kind: Inventory['kind'];
      title: string;
      gameDate: string;
      tickets: number;
      seasonId?: string;
    }
  | { type: 'importSchedule'; csv: string; seasonId: string }
  | ReleaseCommand
  | {
      type: 'interest';
      gameId: GameId;
      purpose: ContactType;
      contactIds: ContactId[];
      quantity: number;
      rationale: string;
      opportunity?: string;
      onBehalfOf?: string;
    }
  | { type: 'waitlist'; requestId: RequestId }
  | { type: 'allocate'; requestId: RequestId; quantity: number; reason: string }
  | { type: 'cancelAllocation'; assignmentId: AssignmentId }
  | {
      type: 'manualTransfer';
      assignmentId: AssignmentId;
      confirmed: boolean;
      reference: string;
    }
  | {
      type: 'attendance';
      assignmentId: AssignmentId;
      outcome: ReviewOutcome;
      evidence: string;
    }
  | { type: 'contactActive'; contactId: ContactId; active: boolean }
  | {
      type: 'saveContact';
      contact: Pick<Contact, 'name' | 'company' | 'email' | 'phone' | 'tier'>;
      id?: ContactId;
    }
  | { type: 'syncDirectory' }
  | { type: 'scoring'; settings: ScoreSettings }
  | { type: 'availability'; body: string; audience: 'sales_team' | 'everyone' }
  | { type: 'followupTemplate'; template: FollowupTemplate }
  | { type: 'followupOutbox' };
export interface CommandResult {
  message: string;
  id?: string;
}
export interface ReviewProvider {
  readonly mode: ReviewSnapshot['mode'];
  subscribe(listener: () => void): () => void;
  revision(): number;
  refresh(): void;
  snapshot(persona: PersonaKey): ReviewSnapshot;
  execute(persona: PersonaKey, command: ReviewCommand): Promise<CommandResult>;
  previewSchedule(persona: PersonaKey, csv: string): SchedulePreview;
  availability(persona: PersonaKey): string;
  rank(persona: PersonaKey, gameId: GameId): GameRankingResult;
}
