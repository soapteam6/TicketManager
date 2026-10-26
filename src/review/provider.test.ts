import { describe, expect, it } from 'vitest';
import { MockReviewProvider, UnavailablePlatformProvider } from './provider';
import { createFixtures, DIRECTORY, GUID, PERSONAS } from './fixtures';
import type { ReviewCommand, ReviewState } from './types';
const NOW = Date.parse('2026-10-26T12:00:00Z'),
  game = GUID(5, 1),
  publicGame = GUID(5, 2),
  customer = GUID(4, 1),
  employee = GUID(4, 5),
  request = GUID(7, 1);
const interest = (
  overrides: Partial<Extract<ReviewCommand, { type: 'interest' }>> = {},
): ReviewCommand => ({
  type: 'interest',
  gameId: publicGame,
  purpose: 'customer',
  contactIds: [customer],
  quantity: 2,
  rationale: 'Synthetic business discussion',
  ...overrides,
});
const create = (state?: ReviewState) =>
  new MockReviewProvider(() => NOW, undefined, state);
const snapshot = (p: MockReviewProvider) => p.snapshot('coordinator');

describe('Code App review provider boundary', () => {
  it('prepares a freeform AI import without creating teams, seasons or inventory', async () => {
    const p = create(), before = snapshot(p);
    const job = await p.startScheduleSearch('coordinator', { query: 'I got VGK tickets for next season', seasonId: '', ticketsPerEvent: 0, homeOnly: true }, 'ai-query');
    const result = await p.getScheduleSearch('coordinator', job.id);
    expect(result.status).toBe('complete');
    expect(result.request.from).toBeUndefined();
    expect(snapshot(p)).toEqual(before);
  });
  it('creates an AI import destination and selected games together, rolling back invalid rows', async () => {
    const p = create(), before = snapshot(p);
    const command: Extract<ReviewCommand, { type: 'importSchedule' }> = {
      type: 'importSchedule', seasonId: '', csv: 'date,time,title,tickets,kind\n2027-10-10,02:00,AI home game,2,game',
      newSeason: { teamId: '', teamName: 'AI example team', label: '2027–28', startDate: '2027-09-01', endDate: '2028-06-30', defaultTickets: 2 },
    };
    await expect(p.execute('coordinator', { ...command, csv: command.csv + '\ninvalid,row' })).rejects.toThrow();
    expect(snapshot(p)).toEqual(before);
    await p.execute('coordinator', command);
    const after = snapshot(p), team = after.teams.find(t => t.name === 'AI example team')!, season = after.seasons.find(s => s.teamId === team.id)!;
    expect(after.catalog.find(g => g.title === 'AI home game')).toMatchObject({ seasonId: season.id, release: 'private', totalTickets: 2 });
    expect(after.teams.length).toBe(before.teams.length + 1);
    expect(after.seasons.length).toBe(before.seasons.length + 1);
  });
  it('fails closed in platform mode and does not fabricate generated schema support', async () => {
    const p = new UnavailablePlatformProvider();
    expect(p.mode).toBe('platform-unavailable');
    expect(p.snapshot('rep').catalog).toEqual([]);
    await expect(p.execute()).rejects.toMatchObject({
      code: 'integration-required',
    });
    expect(() => p.rank()).toThrow('Platform');
  });
  it('projects only released inventory, own interest and eligible contact options to requesters', () => {
    const p = create(),
      rep = p.snapshot('rep'),
      emp = p.snapshot('employee');
    expect(rep.catalog.map((g) => g.id)).toEqual([publicGame]);
    expect(snapshot(p).catalog).toHaveLength(5);
    expect(rep.requests).toHaveLength(3);
    expect(emp.requests).toEqual([]);
    expect(rep.requests[0]).not.toHaveProperty('requesterId');
    expect(rep.requests[0]).not.toHaveProperty('contactIds');
    expect(rep).not.toHaveProperty('contacts');
    expect(rep).not.toHaveProperty('scoring');
    expect(rep).not.toHaveProperty('outbox');
    expect(rep).not.toHaveProperty('attendanceHistory');
    expect(emp.options.map((c) => c.id)).toEqual([employee]);
    expect(() => p.rank('rep', publicGame)).toThrow('Coordinator');
    rep.catalog[0].title = 'mutated';
    expect(p.snapshot('rep').catalog[0].title).not.toBe('mutated');
  });
  it('guards every coordinator command when invoked directly as a requester', async () => {
    const p = create(),
      commands: ReviewCommand[] = [
        { type: 'release', ids: [game], action: 'released' },
        {
          type: 'allocate',
          requestId: request,
          quantity: 1,
          reason: 'Not authorized',
        },
        { type: 'contactActive', contactId: employee, active: false },
        { type: 'syncDirectory' },
        { type: 'availability', audience: 'everyone', body: 'No delivery' },
      ];
    for (const command of commands)
      await expect(p.execute('employee', command)).rejects.toMatchObject({
        code: 'forbidden',
      });
    expect(snapshot(p).outbox).toEqual([]);
    expect(() => p.previewSchedule('rep', '')).toThrow('Coordinator');
  });
});
describe('private, staged and clock-based release', () => {
  it('rejects private interest via the service, but coordinators can record and allocate privately', async () => {
    const p = create();
    await expect(p.execute('rep', interest({ gameId: game }))).rejects.toThrow(
      'Released inventory',
    );
    await p.execute(
      'coordinator',
      interest({ gameId: game, onBehalfOf: PERSONAS.rep.id }),
    );
    await p.execute('coordinator', {
      type: 'allocate',
      requestId: request,
      quantity: 1,
      reason: 'Private preallocation for review',
    });
    expect(p.snapshot('rep').catalog.map((g) => g.id)).not.toContain(game);
    expect(snapshot(p).outbox).toEqual([]);
    await p.execute('coordinator', {
      type: 'release',
      ids: [game],
      action: 'released',
    });
    expect(p.snapshot('rep').catalog.map((g) => g.id)).toContain(game);
    expect(snapshot(p).outbox).toEqual([]);
  });
  it('uses exact explicit-offset instants at the release boundary without a scheduler', async () => {
    let now = NOW;
    const p = new MockReviewProvider(() => now);
    await p.execute('coordinator', {
      type: 'release',
      ids: [game],
      action: 'scheduled',
      at: '2026-10-26T06:00:00-07:00',
    });
    now = Date.parse('2026-10-26T12:59:59.999Z');
    expect(p.snapshot('rep').catalog.map((g) => g.id)).not.toContain(game);
    await expect(
      p.execute('rep', interest({ gameId: game })),
    ).rejects.toThrow();
    now++;
    expect(p.snapshot('rep').catalog.map((g) => g.id)).toContain(game);
    await p.execute('rep', interest({ gameId: game }));
    expect(
      snapshot(p).catalog.find((g) => g.id === game)?.availableTickets,
    ).toBe(4);
  });
  it('releases an inclusive date window atomically and preserves manual private state', async () => {
    const p = create();
    await p.execute('coordinator', {
      type: 'release',
      from: '2026-11-01T00:00:00Z',
      through: '2026-12-15T02:00:00Z',
      action: 'released',
    });
    expect(p.snapshot('employee').catalog).toHaveLength(3);
    await p.execute('coordinator', {
      type: 'release',
      ids: [game],
      action: 'private',
    });
    expect(p.snapshot('employee').catalog).toHaveLength(2);
    const before = snapshot(p);
    await expect(
      p.execute('coordinator', {
        type: 'release',
        ids: [game, GUID(5, 4)],
        action: 'released',
      }),
    ).rejects.toThrow('upcoming');
    expect(snapshot(p)).toEqual(before);
    await expect(
      p.execute('coordinator', {
        type: 'release',
        ids: [game, 'missing'],
        action: 'released',
      }),
    ).rejects.toThrow('does not exist');
    await expect(
      p.execute('coordinator', {
        type: 'release',
        ids: [game],
        action: 'scheduled',
        at: ':00Z',
      }),
    ).rejects.toThrow('ISO');
  });
});
describe('interest and synthetic allocation transaction', () => {
  it('reports requests, distinct requesting people and ticket demand separately without assigning', async () => {
    const p = create();
    await p.execute('rep', interest());
    await p.execute('rep', interest({ quantity: 1 }));
    await p.execute(
      'employee',
      interest({ purpose: 'employee', contactIds: [employee], quantity: 1 }),
    );
    const g = p.snapshot('employee').catalog[0];
    expect(g).toMatchObject({
      requestCount: 3,
      requestingPeople: 2,
      requestedTickets: 4,
      availableTickets: 4,
    });
    expect(snapshot(p).allocations).toHaveLength(2);
    expect(p.snapshot('employee').requests).toHaveLength(1);
  });
  it('validates purpose, quantity, justification, same business and self/on-behalf boundaries', async () => {
    const p = create();
    for (const command of [
      interest({ quantity: 0 }),
      interest({ quantity: 1.5 }),
      interest({ rationale: ' ' }),
      interest({ contactIds: [] }),
      interest({ contactIds: [customer, GUID(4, 3)] }),
      interest({ contactIds: [GUID(4, 6)], purpose: 'employee' }),
    ])
      await expect(p.execute('rep', command)).rejects.toThrow();
    await expect(p.execute('employee', interest())).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      p.execute('rep', interest({ onBehalfOf: PERSONAS.employee.id })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await p.execute('coordinator', interest({ onBehalfOf: PERSONAS.rep.id }));
    expect(p.snapshot('rep').requests).toHaveLength(4);
    await p.execute('rep', interest({ contactIds: [customer, GUID(4, 2)] }));
    expect(snapshot(p).requests.at(-1)?.contactNames).toBe(
      'Alex Sample, Quinn Sample',
    );
  });
  it('permits only one of two competing allocations for the same remaining inventory', async () => {
    const p = create(),
      a = await p.execute('rep', interest({ quantity: 3 })),
      b = await p.execute('rep', interest({ quantity: 3 }));
    const results = await Promise.allSettled([
      p.execute('coordinator', {
        type: 'allocate',
        requestId: a.id!,
        quantity: 3,
        reason: 'First human choice',
      }),
      p.execute('coordinator', {
        type: 'allocate',
        requestId: b.id!,
        quantity: 3,
        reason: 'Second human choice',
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    const s = snapshot(p),
      active = s.allocations!.filter(
        (a) => a.gameId === publicGame && a.status !== 'cancelled',
      );
    expect(active).toHaveLength(3);
    expect(new Set(active.map((a) => a.seatId)).size).toBe(3);
    expect(s.catalog.find((g) => g.id === publicGame)?.availableTickets).toBe(
      1,
    );
    await expect(
      p.execute('coordinator', {
        type: 'allocate',
        requestId: a.id!,
        quantity: 1,
        reason: 'Excess',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('requires human decision, leaves waitlisted demand unallocated, and cancels idempotently', async () => {
    const p = create();
    await p.execute('coordinator', { type: 'waitlist', requestId: request });
    expect(snapshot(p).allocations).toHaveLength(2);
    await expect(
      p.execute('coordinator', {
        type: 'allocate',
        requestId: request,
        quantity: 1,
        reason: ' ',
      }),
    ).rejects.toThrow('reason');
    await p.execute('coordinator', {
      type: 'allocate',
      requestId: request,
      quantity: 1,
      reason: 'Coordinator override',
    });
    const id = snapshot(p).allocations!.at(-1)!.id;
    await p.execute('coordinator', {
      type: 'cancelAllocation',
      assignmentId: id,
    });
    await p.execute('coordinator', {
      type: 'cancelAllocation',
      assignmentId: id,
    });
    expect(
      snapshot(p).catalog.find((g) => g.id === game)?.availableTickets,
    ).toBe(4);
    expect(snapshot(p).allocations!.at(-1)?.status).toBe('cancelled');
    expect(snapshot(p).requests.find((r) => r.id === request)?.allocated).toBe(
      0,
    );
  });
  it('treats scoring and availability preview as pure, nonallocating queries', () => {
    const p = create(),
      before = snapshot(p),
      rank = p.rank('coordinator', game);
    expect(rank.ranked).toHaveLength(1);
    expect(rank.ranked[0].breakdown.filter((f) => f.weight > 0)).toHaveLength(
      4,
    );
    expect(p.availability('coordinator')).toContain('4 tickets');
    expect(snapshot(p)).toEqual(before);
  });
});
describe('directory override, history and attendance', () => {
  it('preserves app overrides through directory refresh, history and requester eligibility', async () => {
    const p = create();
    await p.execute('coordinator', {
      type: 'contactActive',
      contactId: employee,
      active: false,
    });
    await p.execute('coordinator', { type: 'syncDirectory' });
    expect(snapshot(p).contacts!.find((c) => c.id === employee)).toMatchObject({
      appActive: false,
      directoryActive: true,
    });
    expect(p.snapshot('employee').options).toEqual([]);
    await expect(
      p.execute(
        'employee',
        interest({ purpose: 'employee', contactIds: [employee] }),
      ),
    ).rejects.toThrow('active');
    await p.execute('coordinator', {
      type: 'contactActive',
      contactId: customer,
      active: false,
    });
    expect(snapshot(p).allocations).toHaveLength(2);
    await expect(
      p.execute('coordinator', {
        type: 'allocate',
        requestId: request,
        quantity: 1,
        reason: 'History is preserved',
      }),
    ).rejects.toThrow('Inactive');
  });
  it('keeps source inactive separate from app active and does not confuse CRM IDs with directory employees', async () => {
    const state = createFixtures();
    state.contacts[0].directoryId = 'crm-contact-id';
    const p = new MockReviewProvider(
      () => NOW,
      {
        readSnapshot: async () =>
          DIRECTORY.filter((e) => e.id !== 'directory-employee'),
      },
      state,
    );
    await p.execute('coordinator', { type: 'syncDirectory' });
    expect(
      snapshot(p).contacts!.find((c) => c.id === customer)?.directoryActive,
    ).toBe(true);
    expect(snapshot(p).contacts!.find((c) => c.id === employee)).toMatchObject({
      appActive: true,
      directoryActive: false,
    });
    expect(p.snapshot('employee').options).toEqual([]);
  });
  it('awaits directory snapshot before cloning the current state so an override is never lost', async () => {
    let finish!: (entries: typeof DIRECTORY) => void;
    const p = new MockReviewProvider(() => NOW, {
      readSnapshot: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const sync = p.execute('coordinator', { type: 'syncDirectory' });
    await p.execute('coordinator', {
      type: 'contactActive',
      contactId: employee,
      active: false,
    });
    finish(DIRECTORY);
    await sync;
    expect(
      snapshot(p).contacts!.find((c) => c.id === employee)?.appActive,
    ).toBe(false);
  });
  it('records transfer only after explicit manual confirmation and does not infer attendance', async () => {
    const p = create();
    await p.execute('coordinator', {
      type: 'allocate',
      requestId: request,
      quantity: 1,
      reason: 'Human decision',
    });
    const a = snapshot(p).allocations!.at(-1)!;
    await expect(
      p.execute('coordinator', {
        type: 'manualTransfer',
        assignmentId: a.id,
        confirmed: false,
        reference: 'Manual example',
      }),
    ).rejects.toThrow('Confirm');
    await p.execute('coordinator', {
      type: 'manualTransfer',
      assignmentId: a.id,
      confirmed: true,
      reference: 'Synthetic provider step',
    });
    expect(snapshot(p).allocations!.at(-1)).toMatchObject({
      status: 'transferred',
      outcome: 'unknown',
      transferReference: 'Synthetic provider step',
    });
    expect(snapshot(p).outbox).toEqual([]);
  });
  it('requires a past event and explicit no-show evidence while retaining unknown and audit corrections', async () => {
    const p = create();
    await p.execute('coordinator', {
      type: 'allocate',
      requestId: request,
      quantity: 1,
      reason: 'Human decision',
    });
    const future = snapshot(p).allocations!.at(-1)!.id,
      past = GUID(8, 1);
    await expect(
      p.execute('coordinator', {
        type: 'attendance',
        assignmentId: future,
        outcome: 'attended',
        evidence: 'Not yet',
      }),
    ).rejects.toThrow('after');
    await expect(
      p.execute('coordinator', {
        type: 'attendance',
        assignmentId: past,
        outcome: 'no_show',
        evidence: '',
      }),
    ).rejects.toThrow('evidence');
    expect(snapshot(p).allocations!.find((a) => a.id === past)?.outcome).toBe(
      'unknown',
    );
    await p.execute('coordinator', {
      type: 'attendance',
      assignmentId: past,
      outcome: 'no_show',
      evidence: 'Explicit synthetic confirmation',
    });
    await p.execute('coordinator', {
      type: 'attendance',
      assignmentId: past,
      outcome: 'unknown',
      evidence: 'Correction: unconfirmed',
    });
    expect(
      snapshot(p)
        .attendanceHistory!.filter((h) => h.assignmentId === past)
        .map((h) => h.outcome),
    ).toEqual(['no_show', 'unknown']);
    expect(
      snapshot(p).requests.find((r) => r.id === request)?.confirmedNoShows,
    ).toBe(0);
    expect(
      snapshot(p).catalog.filter((g) => g.seasonId === GUID(3, 2)),
    ).toHaveLength(1);
  });
  it('uses same-season awards only and excludes unknown attendance from known reliability', () => {
    const state = createFixtures(),
      p = create(state),
      score = p.rank('coordinator', game).ranked[0];
    expect(score.breakdown.find((f) => f.factor === 'fairness')?.rawValue).toBe(
      1,
    );
    expect(
      score.breakdown.find((f) => f.factor === 'reliability')?.normalizedValue,
    ).toBe(1);
    state.allocations[1].outcome = 'unknown';
    const neutral = create(state).rank('coordinator', game).ranked[0];
    expect(
      neutral.breakdown.find((f) => f.factor === 'reliability')
        ?.normalizedValue,
    ).toBe(0.5);
  });
});
describe('private import, configurable advice and explicit mock messaging', () => {
  it('previews without mutation, imports privately, and rolls back a partially invalid import', async () => {
    const p = create(),
      csv =
        'date,time,title,tickets,kind\n2027-01-10,03:00,"Synthetic, quoted title",2,game\n2027-01-15,02:00,Synthetic Concert,2,event',
      before = snapshot(p);
    const preview = p.previewSchedule('coordinator', csv);
    expect(preview.errors).toEqual([]);
    expect(
      p.previewSchedule(
        'coordinator',
        '2027-01-01,03:00,Extra data,2,event,unexpected',
      ).errors,
    ).toHaveLength(1);
    expect(preview.rows[0].title).toBe('Synthetic, quoted title');
    expect(snapshot(p)).toEqual(before);
    await p.execute('coordinator', {
      type: 'importSchedule',
      csv,
      seasonId: GUID(3, 1),
    });
    expect(
      snapshot(p)
        .catalog.slice(-2)
        .map((g) => [g.released, g.seasonId]),
    ).toEqual([
      [false, GUID(3, 1)],
      [false, null],
    ]);
    const after = snapshot(p);
    await expect(
      p.execute('coordinator', {
        type: 'importSchedule',
        csv: '2027-01-20,03:00,New Row,2,game\n2027-01-15,02:00,Synthetic Concert,2,event',
        seasonId: GUID(3, 1),
      }),
    ).rejects.toThrow('already exists');
    expect(snapshot(p)).toEqual(after);
    expect(
      p.previewSchedule('coordinator', '2026-02-30,25:00,Impossible,2,event')
        .errors,
    ).toHaveLength(1);
  });
  it('allows advisory defaults to change while disabled policy factors stay disabled', async () => {
    const p = create(),
      settings = snapshot(p).scoring!;
    settings.category.employee = 0.4;
    settings.weights.strategicValue = 0.5;
    await p.execute('coordinator', { type: 'scoring', settings });
    expect(snapshot(p).scoring?.category.employee).toBe(0.4);
    settings.weights.leadTime = 0.1;
    await expect(
      p.execute('coordinator', { type: 'scoring', settings }),
    ).rejects.toThrow('Only category');
    expect(snapshot(p).scoring?.weights.leadTime).toBe(0);
  });
  it('starts with no outbox and disabled optional follow-up; only explicit commands add local previews', async () => {
    const p = create();
    expect(snapshot(p).followup?.enabled).toBe(false);
    expect(snapshot(p).outbox).toEqual([]);
    await expect(
      p.execute('coordinator', { type: 'followupOutbox' }),
    ).rejects.toThrow('disabled');
    await p.execute('coordinator', {
      type: 'availability',
      audience: 'sales_team',
      body: p.availability('coordinator'),
    });
    await p.execute('coordinator', {
      type: 'followupTemplate',
      template: { ...snapshot(p).followup!, enabled: true },
    });
    await p.execute('coordinator', { type: 'followupOutbox' });
    expect(snapshot(p).outbox?.map((m) => m.kind)).toEqual([
      'availability',
      'followup',
    ]);
    expect(snapshot(p).allocations).toHaveLength(2);
  });
});
