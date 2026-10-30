import { rankReviewState } from './ranking';
import { FACTOR_KEYS } from '../domain/enums';
import type { GameRankingResult } from '../domain/scoring-types';
import { createFixtures, DIRECTORY, GUID, PERSONAS } from './fixtures';
import { isCalendarDate, parseIsoTimestamp } from './dates';
import { previewScheduleCsv } from './schedule';
import type {
  Allocation,
  AccessUser,
  AccessGroup,
  AppRole,
  ScheduleSearchJob,
  ScheduleSearchRequest,
  CommandResult,
  Contact,
  DirectorySource,
  Inventory,
  Persona,
  PersonaKey,
  ReviewCommand,
  ReviewProvider,
  ReviewSnapshot,
  ReviewState,
  SchedulePreview,
} from './types';

export class ReviewError extends Error {
  readonly code: 'forbidden' | 'invalid' | 'conflict' | 'integration-required';
  constructor(code: ReviewError['code'], message: string) {
    super(message);
    this.code = code;
  }
}
function invalid(message: string): never {
  throw new ReviewError('invalid', message);
}
function integer(value: number, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || value < min || value > max)
    invalid(`${label} must be an integer from ${min} to ${max}`);
}
function text(value: string, label: string, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    invalid(`Enter ${label} (up to ${max} characters)`);
}
function instant(value: string): number {
  const ms = parseIsoTimestamp(value);
  if (ms === null)
    invalid('Enter a real ISO timestamp with seconds and an explicit timezone');
  return ms;
}
function persona(key: PersonaKey): Persona {
  if (!Object.hasOwn(PERSONAS, key))
    throw new ReviewError('forbidden', 'Unknown synthetic persona');
  return PERSONAS[key];
}
function coordinator(actor: Persona) {
  if (actor.role !== 'coordinator')
    throw new ReviewError(
      'forbidden',
      'Coordinator tools are unavailable in the requester view',
    );
  return actor;
}
export function released(game: Inventory, now: number): boolean {
  return (
    game.release === 'released' ||
    (game.release === 'scheduled' &&
      game.releaseAt !== null &&
      instant(game.releaseAt) <= now)
  );
}
function eligible(contact: Contact) {
  return contact.appActive && contact.directoryActive;
}
function active(allocation: Allocation) {
  return allocation.status !== 'cancelled';
}
const defaultDirectory: DirectorySource = {
  readSnapshot: async () => structuredClone(DIRECTORY),
};

// A local, in-memory implementation of the review service boundary. It deliberately never
// imports generated service modules or SDK context. Its atomic writes do not claim to provide
// a Dataverse transaction or authorize a production user.
export class MockReviewProvider implements ReviewProvider {
  private accessUsers: AccessUser[] = Object.values(PERSONAS).map(p => ({
    id: p.id, name: p.name, email: p.email, isAppAdmin: !!p.isAppAdmin,
    directRoles: p.isAppAdmin ? [] : [p.key], inheritedRoles: [], effectiveRole: p.key,
  }));
  private accessGroups: AccessGroup[] = [{ id: '80000000-0000-4000-8000-000000000001', directoryId: '80000000-0000-4000-8000-000000000002', name: 'Demo sales group', type: 'security', membership: 'members', roles: [] }];
  private groupMembers = new Map<string, string[]>([['80000000-0000-4000-8000-000000000001', [PERSONAS.rep.id]]]);
  private scheduleJobs = new Map<string, { owner: string; job: ScheduleSearchJob }>();
  private updateEffectiveAccess() {
    for (const user of this.accessUsers) {
      user.inheritedRoles = [...new Set(this.accessGroups.filter(g => this.groupMembers.get(g.id)?.includes(user.id)).flatMap(g => g.roles))];
      user.effectiveRole = user.isAppAdmin ? 'coordinator' : ['coordinator', 'rep', 'employee'].find(r => [...user.directRoles, ...user.inheritedRoles].includes(r as AppRole)) as AppRole | undefined ?? 'none';
    }
  }
  private actor(key: PersonaKey): Persona {
    const base = persona(key);
    const user = this.accessUsers.find(u => u.id === base.id)!;
    if (user.effectiveRole === 'none') throw new ReviewError('forbidden', 'A Ticket Manager role is required. Ask an app admin to grant access.');
    return { ...base, key: user.effectiveRole, role: user.effectiveRole === 'coordinator' ? 'coordinator' : 'requester' };
  }
  readonly mode = 'mock' as const;
  private state: ReviewState;
  private version = 0;
  private sequence = 1000;
  private listeners = new Set<() => void>();
  private readonly clock: () => number;
  private readonly directory: DirectorySource;
  constructor(
    clock: () => number = Date.now,
    directory: DirectorySource = defaultDirectory,
    initial: ReviewState = createFixtures(),
  ) {
    this.clock = clock;
    this.directory = directory;
    this.state = structuredClone(initial);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  revision = () => this.version;
  refresh = () => {
    this.version++;
    for (const listener of this.listeners) listener();
  };
  private id() {
    return GUID(9, ++this.sequence);
  }
  snapshot(key: PersonaKey): ReviewSnapshot {
    const actor = this.actor(key),
      admin = actor.role === 'coordinator',
      now = this.clock(),
      state = this.state;
    const visible = state.games.filter(
      (g) =>
        !g.removed && (admin ||
        (released(g, now) &&
          g.status === 'scheduled' &&
          instant(g.gameDate) > now)),
    );
    const catalog = visible.map((g) => {
      const demand = state.requests.filter(
        (r) => r.gameId === g.id && r.status !== 'cancelled',
      );
      return {
        ...g,
        released: released(g, now),
        availableTickets: state.seats.filter(
          (s) => s.gameId === g.id && s.status === 'available',
        ).length,
        requestCount: demand.length,
        requestingPeople: new Set(demand.map((r) => r.requesterId)).size,
        requestedTickets: demand.reduce((sum, r) => sum + r.quantity, 0),
        seasonLabel: state.seasons.find((s) => s.id === g.seasonId)?.label,
        seasonStartDate: state.seasons.find(s => s.id === g.seasonId)?.startDate,
        seasonEndDate: state.seasons.find(s => s.id === g.seasonId)?.endDate,
        teamId: state.seasons.find((s) => s.id === g.seasonId)?.teamId,
        teamName: state.teams.find(t => t.id === state.seasons.find(s => s.id === g.seasonId)?.teamId)?.name,
      };
    });
    const requests = state.requests
      .filter((r) => admin || r.requesterId === actor.id)
      .map((r) => ({
        id: r.id,
        gameId: r.gameId,
        quantity: r.quantity,
        purpose: r.purpose,
        rationale: r.rationale,
        opportunity: r.opportunity,
        status: r.status,
        createdAt: r.createdAt,
        contactNames: r.contactIds
          .map(
            (id) =>
              state.contacts.find((c) => c.id === id)?.name ??
              'Historical contact',
          )
          .join(', '),
        allocated: state.allocations.filter(
          (a) => a.requestId === r.id && active(a),
        ).length,
        ...(admin
          ? {
              contactIds: [...r.contactIds],
              requesterId: r.requesterId,
              requesterName: Object.values(PERSONAS).find((p) => p.id === r.requesterId)?.name,
              requesterEmail: Object.values(PERSONAS).find((p) => p.id === r.requesterId)?.email,
              recordedById: r.recordedBy,
              recordedByName: Object.values(PERSONAS).find((p) => p.id === r.recordedBy)?.name,
              confirmedNoShows: state.allocations.filter(
                (a) =>
                  r.contactIds.includes(a.contactId) && a.outcome === 'no_show',
              ).length,
            }
          : {}),
      }));
    const options = state.contacts
      .filter(
        (c) =>
          eligible(c) &&
          (admin ||
            (c.type === 'customer' && actor.key === 'rep') ||
            c.directoryId === actor.directoryId),
      )
      .map((c) => ({
        id: c.id,
        type: c.type,
        name: c.name,
        company: c.company,
        email: c.email,
        phone: c.phone,
      }));
    return structuredClone({
      mode: this.mode,
      serverNow: new Date(now).toISOString(),
      persona: actor,
      catalog,
      requests,
      options,
      teams: admin ? state.teams : [],
      seasons: admin ? state.seasons : [],
      scheduleSearchAvailable: admin,
      ...(actor.isAppAdmin ? { accessUsers: this.accessUsers, accessGroups: this.accessGroups } : {}),
      ...(admin
        ? {
            contacts: state.contacts,
            allocations: state.allocations,
            attendanceHistory: state.attendanceHistory,
            outbox: state.outbox,
            followup: state.followup,
            scoring: state.scoring,
          }
        : {}),
    });
  }
  previewSchedule(key: PersonaKey, csv: string): SchedulePreview {
    coordinator(this.actor(key));
    return previewScheduleCsv(csv);
  }
  async startScheduleSearch(key: PersonaKey, request: ScheduleSearchRequest, jobId: string): Promise<ScheduleSearchJob> {
    const actor = coordinator(this.actor(key));
    const season = this.state.seasons.find(s => s.id === request.seasonId);
    if (request.seasonId && !season) invalid('Choose a season.');
    text(request.query, 'an import request', 2000); integer(request.ticketsPerEvent, 0, 1000, 'Tickets');
    const existing = this.scheduleJobs.get(jobId);
    if (existing) {
      if (existing.owner !== actor.id) throw new ReviewError('forbidden', 'Search not found.');
      return structuredClone(existing.job);
    }
    const job: ScheduleSearchJob = { id: jobId, status: 'queued', request: { ...request, from: season?.startDate, through: season?.endDate, seasonLabel: season?.label } };
    this.scheduleJobs.set(jobId, { owner: actor.id, job });
    return structuredClone(job);
  }
  async getScheduleSearch(key: PersonaKey, jobId: string): Promise<ScheduleSearchJob> {
    const actor = coordinator(this.actor(key));
    const record = this.scheduleJobs.get(jobId);
    if (!record || record.owner !== actor.id) throw new ReviewError('forbidden', 'Search not found.');
    const job = record.job;
    if (job.status === 'queued') {
      const date = new Date(`${job.request.from || '2027-09-01'}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 10);
      const day = date.toISOString().slice(0, 10), sourceUrl = 'https://schedule.example.invalid/official';
      job.status = 'complete';
      job.rawResult = { stop_reason: 'end_turn', content: [
        { type: 'server_tool_use', name: 'web_search' },
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: sourceUrl, title: 'Synthetic schedule source' }] },
          { type: 'text', text: JSON.stringify({ team: 'Demo schedule search', season: job.request.seasonLabel || '2027–28', seasonStart: job.request.from || '2027-09-01', seasonEnd: job.request.through || '2028-04-30', timezone: 'UTC', warnings: ['Synthetic preview only. No web search or external service was called.'], games: [
          { title: 'Discovered demo opponent', localDate: day, localTime: '12:00', startAt: date.toISOString(), home: true, venue: 'Demo stadium', sourceUrl },
          { title: 'Demo time TBD', localDate: day, localTime: null, startAt: null, home: true, sourceUrl },
        ] }) }
      ] };
    }
    return structuredClone(job);
  }
  availability(key: PersonaKey): string {
    coordinator(this.actor(key));
    const available = this.snapshot(key).catalog.filter(
      (g) =>
        g.released &&
        g.status === 'scheduled' &&
        instant(g.gameDate) > this.clock() &&
        g.availableTickets > 0,
    );
    const count = available.reduce((sum, g) => sum + g.availableTickets, 0);
    return `${count} tickets available across ${available.length} released events. Express interest in the app; a coordinator decides allocations. Requests do not guarantee tickets.`;
  }
  rank(key: PersonaKey, gameId: string): GameRankingResult {
    coordinator(this.actor(key));
    return rankReviewState(this.state, gameId, this.clock());
  }

  async execute(
    key: PersonaKey,
    command: ReviewCommand,
  ): Promise<CommandResult> {
    const actor = this.actor(key);
    if (command.type !== 'interest') coordinator(actor);
    if (command.type === 'setUserRole') {
      if (!actor.isAppAdmin) throw new ReviewError('forbidden', 'Only an app admin can assign roles.');
      const user = this.accessUsers.find(u => u.id === command.userId);
      if (!user || user.isAppAdmin) invalid('Select a user whose app role can be changed.');
      if (JSON.stringify([...user.directRoles].sort()) !== JSON.stringify([...command.expectedDirectRoles].sort())) throw new ReviewError('conflict', 'This user’s roles changed. Refresh and review before saving.');
      if (!['none', 'coordinator', 'rep', 'employee'].includes(command.role)) invalid('Select a supported Ticket Manager role.');
      user.directRoles = command.role === 'none' ? [] : [command.role as AppRole];
      this.updateEffectiveAccess();
      this.refresh();
      return { message: 'Synthetic access updated.' };
    }
    if (command.type === 'setGroupRole' || command.type === 'connectGroup') {
      if (!actor.isAppAdmin) throw new ReviewError('forbidden', 'Only an app admin can assign group roles.');
      if (!['none', 'coordinator', 'rep', 'employee'].includes(command.role)) invalid('Select a supported Ticket Manager role.');
      let group: AccessGroup;
      if (command.type === 'connectGroup') {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.directoryId) || command.directoryId === '00000000-0000-0000-0000-000000000000') invalid('Enter the Microsoft Entra group’s Object ID.');
        if (this.accessGroups.some(g => g.directoryId.toLowerCase() === command.directoryId.toLowerCase() && g.membership === 'members')) invalid('This group is already linked for members. Select it from Groups to change its role.');
        group = { id: this.id(), directoryId: command.directoryId, name: 'Demo directory group', type: 'security', membership: 'members', roles: [] };
        this.accessGroups.push(group);
      } else {
        const selected = this.accessGroups.find(g => g.id === command.groupId);
        if (!selected) invalid('Select a linked group.');
        group = selected;
        if (JSON.stringify([...group.roles].sort()) !== JSON.stringify([...command.expectedRoles].sort())) throw new ReviewError('conflict', 'The assigned roles changed. Refresh and review before saving.');
      }
      group.roles = command.role === 'none' ? [] : [command.role];
      this.updateEffectiveAccess(); this.refresh();
      return { message: 'Synthetic group access updated.', id: group.id };
    }
    // Only the synthetic directory interface can be awaited; after it completes the transaction
    // clones the latest state. No await or fallible external operation occurs inside the commit.
    const entries =
      command.type === 'syncDirectory'
        ? await this.directory.readSnapshot()
        : [];
    const next = structuredClone(this.state),
      now = this.clock(),
      at = new Date(now).toISOString();
    let result: CommandResult = {
      message:
        'Local mock change saved. No platform or external service was contacted.',
    };
    switch (command.type) {
      case 'createTeam': {
        text(command.name, 'a team name', 200);
        integer(command.defaultTickets, 0, 1000, 'Default tickets');
        if (
          next.teams.some(
            (t) => t.name.toLowerCase() === command.name.trim().toLowerCase(),
          )
        )
          invalid('A team with that name already exists');
        const id = this.id();
        next.teams.push({
          id,
          name: command.name.trim(),
          defaultTickets: command.defaultTickets,
        });
        result = {
          id,
          message: 'Synthetic team created. Add a season and private games.',
        };
        break;
      }
      case 'createSeason': {
        if (!next.teams.some((t) => t.id === command.teamId))
          invalid('Select a team');
        text(command.label, 'a season label', 200);
        if (
          !isCalendarDate(command.startDate) ||
          !isCalendarDate(command.endDate) ||
          command.endDate < command.startDate
        )
          invalid('Enter valid, ordered calendar dates');
        if (
          next.seasons.some(
            (s) =>
              s.teamId === command.teamId && s.label === command.label.trim(),
          )
        )
          invalid('Season label already exists for this team');
        const id = this.id();
        next.seasons.push({
          id,
          teamId: command.teamId,
          label: command.label.trim(),
          startDate: command.startDate,
          endDate: command.endDate,
        });
        result = {
          id,
          message:
            'Synthetic season created. Calendar dates are retained without timezone conversion.',
        };
        break;
      }
      case 'createInventory': {
        const id = this.addInventory(next, command);
        result = {
          id,
          message:
            'Inventory created privately. Release and announcements are separate choices.',
        };
        break;
      }
      case 'editInventory': {
        const game = next.games.find(g => g.id === command.gameId && !g.removed);
        if (!game) invalid('Event not found');
        text(command.title, 'an event title', 200); instant(command.gameDate); integer(command.tickets, 0, 1000, 'Ticket inventory');
        if (!['game', 'event'].includes(command.kind) || !['scheduled', 'completed', 'cancelled'].includes(command.status)) invalid('Choose a valid event type and status');
        const seasonId = command.kind === 'game' ? command.seasonId ?? '' : null;
        if (command.kind === 'game' && !next.seasons.some(s => s.id === seasonId)) invalid('Choose a season');
        const allocations = next.allocations.filter(a => a.gameId === game.id);
        const hasHistory = allocations.length > 0 || next.requests.some(r => r.gameId === game.id);
        if (hasHistory && (game.kind !== command.kind || game.seasonId !== seasonId)) invalid('An event with request or allocation history cannot change type or season.');
        if (command.status === 'cancelled' && allocations.some(active)) invalid('Cancel active allocations before cancelling this event.');
        if ((command.status === 'completed' || allocations.some(a => a.outcome !== 'unknown')) && instant(command.gameDate) > now) invalid('Completed events or confirmed attendance cannot be in the future.');
        if (next.games.some(g => g.id !== game.id && !g.removed && g.title === command.title.trim() && instant(g.gameDate) === instant(command.gameDate))) invalid('Duplicate dated inventory.');
        const seats = next.seats.filter(s => s.gameId === game.id);
        const protectedIds = new Set(allocations.map(a => a.seatId));
        const removable = seats.filter(s => s.status === 'available' && !protectedIds.has(s.id));
        if (seats.length - command.tickets > removable.length) invalid('Ticket quantity cannot be reduced below tickets with allocation history.');
        const removed = new Set(removable.slice(0, Math.max(0, seats.length - command.tickets)).map(s => s.id));
        next.seats = next.seats.filter(s => !removed.has(s.id));
        let label = Math.max(0, ...seats.map(s => Number(s.label.match(/\d+$/)?.[0] ?? 0)));
        for (let i = seats.length; i < command.tickets; i++) next.seats.push({ id: this.id(), gameId: game.id, label: `Ticket ${++label}`, status: 'available' });
        Object.assign(game, { title: command.title.trim(), gameDate: command.gameDate, kind: command.kind, seasonId, totalTickets: command.tickets, status: command.status });
        if (command.status !== 'scheduled') { game.release = 'private'; game.releaseAt = null; }
        result = { message: 'Event updated.' }; break;
      }
      case 'removeInventory': {
        const game = next.games.find(g => g.id === command.gameId && !g.removed);
        if (!game) invalid('Event not found');
        if (next.requests.some(r => r.gameId === game.id) || next.allocations.some(a => a.gameId === game.id)) invalid('Events with requests or allocations cannot be removed.');
        Object.assign(game, { removed: true, status: 'cancelled', release: 'private', releaseAt: null });
        result = { message: 'Event removed from inventory.' }; break;
      }
      case 'importSchedule': {
        let targetSeason = command.seasonId;
        if (command.newSeason) {
          if (targetSeason) invalid('Choose an existing season or a new season, not both.');
          const d = command.newSeason;
          text(d.label, 'a season label', 200);
          if (!isCalendarDate(d.startDate) || !isCalendarDate(d.endDate) || d.startDate > d.endDate) invalid('Enter valid season dates.');
          let targetTeam = d.teamId;
          if (!targetTeam) {
            text(d.teamName, 'a team name', 200); integer(d.defaultTickets, 0, 1000, 'Default tickets');
            targetTeam = next.teams.find(t => t.name.toLowerCase() === d.teamName.trim().toLowerCase())?.id ?? '';
            if (!targetTeam) { targetTeam = this.id(); next.teams.push({ id: targetTeam, name: d.teamName.trim(), defaultTickets: d.defaultTickets }); }
          }
          if (!next.teams.some(t => t.id === targetTeam)) invalid('Choose a team.');
          if (next.seasons.some(s => s.teamId === targetTeam && s.label.toLowerCase() === d.label.trim().toLowerCase())) invalid('A season with that label already exists for this team. Select it from the list.');
          targetSeason = this.id(); next.seasons.push({ id: targetSeason, teamId: targetTeam, label: d.label.trim(), startDate: d.startDate, endDate: d.endDate });
        }
        if (!next.seasons.some((s) => s.id === targetSeason))
          invalid('Choose a season for sports imports');
        const preview = previewScheduleCsv(command.csv);
        if (preview.errors.length) invalid(preview.errors.join(' '));
        for (const row of preview.rows)
          this.addInventory(next, {
            ...row,
            seasonId: row.kind === 'game' ? targetSeason : undefined,
          });
        result = {
          message: `Imported ${preview.rows.length} private inventory items. Nothing published or announced.`,
        };
        break;
      }
      case 'release': {
        if (command.ids && (command.from || command.through))
          invalid('Choose selected inventory or a date window');
        if (!command.ids && (!command.from || !command.through))
          invalid('Select inventory or both UTC window boundaries');
        if (command.ids && !command.ids.length) invalid('Select inventory');
        const start = command.from ? instant(command.from) : null,
          end = command.through ? instant(command.through) : null;
        if (start !== null && end !== null && start > end)
          invalid('Window end precedes start');
        if (!['private', 'released', 'scheduled'].includes(command.action))
          invalid('Choose a release action');
        if (
          command.action === 'scheduled' &&
          (!command.at || instant(command.at) <= now)
        )
          invalid('Schedule a future ISO release instant');
        const ids = command.ids ? new Set(command.ids) : null;
        const selected = next.games.filter((g) =>
          ids
            ? ids.has(g.id)
            : instant(g.gameDate) >= start! && instant(g.gameDate) <= end!,
        );
        if (!selected.length || (ids && selected.length !== ids.size))
          invalid(
            'The selected inventory does not exist or the date window is empty',
          );
        if (
          command.action !== 'private' &&
          selected.some(
            (g) => g.status !== 'scheduled' || instant(g.gameDate) <= now,
          )
        )
          invalid('Only upcoming scheduled inventory can be released');
        for (const game of selected) {
          game.release = command.action;
          game.releaseAt = command.action === 'scheduled' ? command.at! : null;
        }
        result = {
          message: 'Visibility settings saved. No announcement was created.',
        };
        break;
      }
      case 'interest': {
        const game = next.games.find((g) => g.id === command.gameId);
        if (!game || (actor.role !== 'coordinator' && !released(game, now)))
          invalid('Released inventory not found');
        if (
          game.status !== 'scheduled' ||
          (actor.role !== 'coordinator' && instant(game.gameDate) <= now)
        )
          invalid('This event no longer accepts new interest');
        integer(command.quantity, 1, 100, 'Requested quantity');
        text(command.rationale, 'a concise business justification');
        if (!['customer', 'employee'].includes(command.purpose))
          invalid('Choose employee/self or customer purpose');
        const ids = [...new Set(command.contactIds)];
        if (!ids.length || ids.length > command.quantity)
          invalid('Select active contacts and at least one ticket per contact');
        const contacts = ids.map((id) =>
          next.contacts.find((c) => c.id === id),
        );
        if (
          contacts.some((c) => !c || !eligible(c) || c.type !== command.purpose)
        )
          invalid('Select active contacts matching the purpose');
        if (
          command.purpose === 'customer' &&
          new Set(contacts.map((c) => c!.company)).size !== 1
        )
          invalid('Choose contacts from one customer');
        if (
          actor.role !== 'coordinator' &&
          (command.onBehalfOf ||
            (actor.key === 'employee' && command.purpose !== 'employee') ||
            (command.purpose === 'employee' &&
              contacts.some((c) => c?.directoryId !== actor.directoryId)))
        )
          throw new ReviewError(
            'forbidden',
            'Only coordinators enter on behalf of other people; employees request for self',
          );
        const actorContact = next.contacts.find(
          (c) => c.directoryId === actor.directoryId && c.type === 'employee',
        );
        if (
          actor.role !== 'coordinator' &&
          actorContact &&
          !eligible(actorContact)
        )
          invalid('Your employee entry is inactive in the app or directory');
        const requester = command.onBehalfOf
          ? Object.values(PERSONAS).find((p) => p.id === command.onBehalfOf)
          : actor;
        if (!requester) invalid('Choose a known synthetic requesting person');
        const requesterContact = next.contacts.find(
          (c) =>
            c.type === 'employee' && c.directoryId === requester.directoryId,
        );
        if (requesterContact && !eligible(requesterContact))
          invalid('Requesting person is inactive');
        const id = this.id();
        next.requests.push({
          id,
          gameId: game.id,
          requesterId: requester.id,
          recordedBy: actor.id,
          purpose: command.purpose,
          contactIds: ids,
          quantity: command.quantity,
          rationale: command.rationale.trim(),
          opportunity: command.opportunity?.trim() ?? '',
          status: 'submitted',
          createdAt: at,
        });
        result = {
          id,
          message: 'Interest recorded. No tickets allocated or transferred.',
        };
        break;
      }
      case 'waitlist': {
        const request = next.requests.find((r) => r.id === command.requestId);
        if (!request || request.status === 'cancelled')
          invalid('Choose active interest');
        if (
          next.allocations.some((a) => a.requestId === request.id && active(a))
        )
          invalid('Cancel active allocations individually before waitlisting');
        request.status = 'waitlisted';
        result = {
          message:
            'Interest waitlisted. No seats held or automatically assigned.',
        };
        break;
      }
      case 'allocate': {
        integer(command.quantity, 1, 100, 'Allocation quantity');
        text(command.reason, 'a coordinator decision / override reason');
        const request = next.requests.find((r) => r.id === command.requestId);
        if (!request || request.status === 'cancelled')
          invalid('Choose active interest');
        const contacts = request.contactIds.map((id) =>
          next.contacts.find((c) => c.id === id),
        );
        if (contacts.some((c) => !c || !eligible(c)))
          invalid('Inactive beneficiaries cannot receive new allocations');
        const existing = next.allocations.filter(
          (a) => a.requestId === request.id && active(a),
        );
        const pool = next.seats.filter(
          (s) => s.gameId === request.gameId && s.status === 'available',
        );
        if (
          command.quantity > request.quantity - existing.length ||
          pool.length < command.quantity
        )
          throw new ReviewError(
            'conflict',
            'Not enough available tickets or the requested quantity is already allocated',
          );
        for (const [index, seat] of pool.slice(0, command.quantity).entries()) {
          next.allocations.push({
            id: this.id(),
            requestId: request.id,
            gameId: request.gameId,
            seatId: seat.id,
            contactId:
              request.contactIds[
                Math.min(request.contactIds.length - 1, existing.length + index)
              ],
            status: 'approved',
            decision: command.reason.trim(),
            decidedBy: actor.id,
            transferReference: '',
            outcome: 'unknown',
            evidence: '',
          });
          seat.status = 'assigned';
        }
        request.status =
          existing.length + command.quantity === request.quantity
            ? 'fulfilled'
            : 'partially_fulfilled';
        result = {
          message:
            'Allocation recorded by coordinator choice. Complete transfer manually in the provider app.',
        };
        break;
      }
      case 'cancelAllocation': {
        const allocation = next.allocations.find(
          (a) => a.id === command.assignmentId,
        );
        if (!allocation) invalid('Allocation not found');
        if (allocation.status !== 'cancelled') {
          allocation.status = 'cancelled';
          next.seats.find((s) => s.id === allocation.seatId)!.status =
            'available';
          const request = next.requests.find(
            (r) => r.id === allocation.requestId,
          )!;
          request.status = next.allocations.some(
            (a) => a.requestId === request.id && active(a),
          )
            ? 'partially_fulfilled'
            : 'submitted';
        }
        result = {
          message:
            'Local allocation cancelled; history retained. Freed inventory awaits a coordinator decision. No provider transfer was reversed.',
        };
        break;
      }
      case 'manualTransfer': {
        const allocation = next.allocations.find(
          (a) => a.id === command.assignmentId,
        );
        if (!allocation || allocation.status === 'cancelled')
          invalid('Choose an approved allocation');
        if (!command.confirmed) invalid('Confirm the manual provider-app step');
        text(command.reference, 'a manual transfer reference', 200);
        allocation.status = 'transferred';
        allocation.transferReference = command.reference.trim();
        next.seats.find((s) => s.id === allocation.seatId)!.status =
          'transferred';
        result = {
          message:
            'Manual transfer recorded locally. This app did not deliver tickets or contact a provider.',
        };
        break;
      }
      case 'attendance': {
        const allocation = next.allocations.find(
          (a) => a.id === command.assignmentId,
        );
        if (!allocation || !active(allocation))
          invalid('Choose an active allocation');
        if (!['unknown', 'attended', 'no_show'].includes(command.outcome))
          invalid('Choose an attendance outcome');
        const game = next.games.find((g) => g.id === allocation.gameId)!;
        if (command.outcome !== 'unknown' && instant(game.gameDate) > now)
          invalid('Confirm attendance only after the event');
        if (command.outcome !== 'unknown')
          text(command.evidence, 'attendance evidence / confirmation note');
        allocation.outcome = command.outcome;
        allocation.evidence = command.evidence.trim();
        next.attendanceHistory.push({
          assignmentId: allocation.id,
          outcome: command.outcome,
          evidence: allocation.evidence,
          recordedAt: at,
          recordedBy: actor.id,
        });
        result = {
          message:
            'Attendance saved. Unknown evidence does not count as a no-show.',
        };
        break;
      }
      case 'contactActive': {
        const contact = next.contacts.find((c) => c.id === command.contactId);
        if (!contact) invalid('Contact not found');
        contact.appActive = command.active;
        result = {
          message:
            'App eligibility saved. Directory state and cross-season history retained.',
        };
        break;
      }
      case 'saveContact': {
        text(command.contact.name, 'a name', 200);
        text(command.contact.company, 'a business', 200);
        if (
          command.contact.email &&
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(command.contact.email)
        )
          invalid('Enter a valid email address');
        const contact = command.id
          ? next.contacts.find((c) => c.id === command.id)
          : undefined;
        if (command.id && !contact) invalid('Contact not found');
        if (contact) Object.assign(contact, command.contact);
        else
          next.contacts.push({
            id: this.id(),
            ...command.contact,
            type: 'customer',
            appActive: true,
            directoryActive: true,
            directoryId: null,
          });
        result = {
          message:
            'Local contact saved. Phone details support manual provider transfers.',
        };
        break;
      }
      case 'syncDirectory': {
        for (const contact of next.contacts.filter(
          (c) => c.type === 'employee' && c.directoryId,
        )) {
          const entry = entries.find((e) => e.id === contact.directoryId);
          contact.directoryActive = entry?.active ?? false;
          if (entry) {
            contact.name = entry.name;
            contact.email = entry.email;
            if (entry.phone) contact.phone = entry.phone;
          }
        }
        for (const entry of entries)
          if (
            !next.contacts.some(
              (c) => c.type === 'employee' && c.directoryId === entry.id,
            )
          )
            next.contacts.push({
              id: this.id(),
              type: 'employee',
              name: entry.name,
              company: 'Synthetic Demo',
              email: entry.email,
              phone: entry.phone,
              tier: 'bronze',
              appActive: true,
              directoryActive: entry.active,
              directoryId: entry.id,
            });
        result = {
          message:
            'Synthetic directory refreshed. App overrides preserved. No directory contacted or modified.',
        };
        break;
      }
      case 'scoring': {
        for (const factor of FACTOR_KEYS)
          if (
            !Number.isFinite(command.settings.weights[factor]) ||
            command.settings.weights[factor] < 0 ||
            command.settings.weights[factor] > 1
          )
            invalid('Weights must be between 0 and 1');
        for (const value of Object.values(command.settings.category))
          if (!Number.isFinite(value) || value < 0 || value > 1)
            invalid('Category defaults must be between 0 and 1');
        if (
          [
            'attendanceRate',
            'leadTime',
            'premiumDemandBalance',
            'employeeCustomerBalance',
          ].some(
            (k) =>
              command.settings.weights[
                k as keyof typeof command.settings.weights
              ] !== 0,
          )
        )
          invalid(
            'Only category, rationale, season fairness and reliability are enabled in this review',
          );
        if (!Object.values(command.settings.weights).some((v) => v > 0))
          invalid('Enable at least one advisory factor');
        next.scoring = structuredClone(command.settings);
        result = {
          message:
            'Demonstration scoring defaults saved. Every allocation remains a human decision.',
        };
        break;
      }
      case 'availability': {
        text(command.body, 'an availability preview', 2000);
        if (!['sales_team', 'everyone'].includes(command.audience))
          invalid('Choose a mock audience');
        next.outbox.push({
          id: this.id(),
          kind: 'availability',
          subject: 'Tickets available — express interest',
          body: command.body.trim(),
          audience: command.audience,
          createdAt: at,
        });
        result = {
          message:
            'Availability preview added to local mock outbox. Nothing sent.',
        };
        break;
      }
      case 'followupTemplate': {
        text(command.template.subject, 'a subject', 200);
        text(command.template.body, 'a follow-up preview', 2000);
        next.followup = structuredClone(command.template);
        result = {
          message:
            'Optional local follow-up template saved. No automatic delivery enabled.',
        };
        break;
      }
      case 'followupOutbox': {
        if (!next.followup.enabled)
          invalid(
            'Optional follow-up is disabled; enable and save the local template first',
          );
        next.outbox.push({
          id: this.id(),
          kind: 'followup',
          subject: next.followup.subject,
          body: next.followup.body,
          audience: 'Synthetic preview audience',
          createdAt: at,
        });
        result = {
          message:
            'Saved follow-up added to local mock outbox. Nothing sent; no photo required or uploaded.',
        };
        break;
      }
      default:
        invalid('Unsupported review action');
    }
    this.assertIntegrity(next);
    this.state = next;
    this.refresh();
    return result;
  }
  private addInventory(
    state: ReviewState,
    input: {
      kind: 'game' | 'event';
      title: string;
      gameDate: string;
      tickets: number;
      seasonId?: string;
    },
  ): string {
    text(input.title, 'an event title / opponent', 200);
    instant(input.gameDate);
    integer(input.tickets, 0, 1000, 'Ticket inventory');
    if (!['game', 'event'].includes(input.kind))
      invalid('Choose a game or event');
    if (
      input.kind === 'game' &&
      !state.seasons.some((s) => s.id === input.seasonId)
    )
      invalid('Sports games require a selected season');
    if (
      state.games.some(
        (g) =>
          !g.removed && g.title === input.title.trim() &&
          instant(g.gameDate) === instant(input.gameDate),
      )
    )
      invalid('That dated inventory already exists');
    const id = this.id();
    state.games.push({
      id,
      kind: input.kind,
      title: input.title.trim(),
      gameDate: input.gameDate,
      totalTickets: input.tickets,
      seasonId: input.kind === 'game' ? input.seasonId! : null,
      status: 'scheduled',
      release: 'private',
      releaseAt: null,
    });
    for (let i = 0; i < input.tickets; i++)
      state.seats.push({
        id: this.id(),
        gameId: id,
        label: `Ticket ${i + 1}`,
        status: 'available',
      });
    return id;
  }
  private assertIntegrity(state: ReviewState) {
    const assigned = state.allocations.filter(active),
      seats = new Set(assigned.map((a) => a.seatId));
    if (seats.size !== assigned.length)
      throw new ReviewError(
        'conflict',
        'A ticket already has an active allocation',
      );
    for (const request of state.requests)
      if (
        assigned.filter((a) => a.requestId === request.id).length >
        request.quantity
      )
        throw new ReviewError(
          'conflict',
          'Allocation exceeds requested quantity',
        );
    for (const seat of state.seats) {
      const owner = assigned.find((a) => a.seatId === seat.id);
      if (
        (seat.status === 'available') === Boolean(owner) ||
        (owner && owner.gameId !== seat.gameId)
      )
        throw new ReviewError('conflict', 'Ticket inventory is inconsistent');
    }
  }
}

// Fail closed for the new workflow until a reviewed platform implementation exists. Existing
// SDK routes remain separate; importing this provider cannot initialize the SDK or read data.
export class UnavailablePlatformProvider implements ReviewProvider {
  readonly mode = 'platform-unavailable' as const;
  subscribe() {
    return () => {};
  }
  revision() {
    return 0;
  }
  refresh() {}
  snapshot(key: PersonaKey): ReviewSnapshot {
    return {
      mode: this.mode,
      persona: persona(key),
      catalog: [],
      requests: [],
      options: [],
      teams: [],
      seasons: [],
    };
  }
  async execute(): Promise<CommandResult> {
    throw new ReviewError(
      'integration-required',
      'The new review workflow requires approved Dataverse release, attendance, role and transaction contracts. Use the isolated synthetic review entry.',
    );
  }
  previewSchedule(): SchedulePreview {
    throw new ReviewError(
      'integration-required',
      'Use the isolated synthetic review entry',
    );
  }
  availability(): string {
    throw new ReviewError(
      'integration-required',
      'Platform review integration is not configured',
    );
  }
  rank(): GameRankingResult {
    throw new ReviewError(
      'integration-required',
      'Platform review integration is not configured',
    );
  }
}
