import type {
  DirectoryEntry,
  Persona,
  ReviewState,
  Team,
  Season,
  Inventory,
  Contact,
} from './types';

export const PERSONAS: Record<'coordinator' | 'rep' | 'employee', Persona> = {
  coordinator: {
    key: 'coordinator',
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Demo Coordinator',
    email: 'coordinator@example.invalid',
    role: 'coordinator',
  },
  rep: {
    key: 'rep',
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Demo Representative',
    email: 'rep@example.invalid',
    role: 'requester',
    directoryId: 'directory-rep',
  },
  employee: {
    key: 'employee',
    id: '10000000-0000-4000-8000-000000000003',
    name: 'Demo Employee',
    email: 'employee@example.invalid',
    role: 'requester',
    directoryId: 'directory-employee',
  },
};
export const DIRECTORY: DirectoryEntry[] = [
  {
    id: 'directory-rep',
    name: 'Demo Representative',
    email: 'rep@example.invalid',
    phone: '+1 202 555 0102',
    active: true,
  },
  {
    id: 'directory-employee',
    name: 'Demo Employee',
    email: 'employee@example.invalid',
    phone: '+1 202 555 0103',
    active: true,
  },
  {
    id: 'directory-inactive',
    name: 'Directory Inactive Example',
    email: 'inactive@example.invalid',
    phone: '+1 202 555 0104',
    active: false,
  },
];
export const GUID = (group: number, number: number) =>
  `${group.toString().padStart(8, '0')}-0000-4000-8000-${number.toString().padStart(12, '0')}`;
export function createFixtures(): ReviewState {
  const teams: Team[] = [
    { id: GUID(2, 1), name: 'Synthetic Comets', defaultTickets: 4 },
  ];
  const seasons: Season[] = [
    {
      id: GUID(3, 1),
      teamId: teams[0].id,
      label: '2026–27 Demo',
      startDate: '2026-09-01',
      endDate: '2027-04-30',
    },
    {
      id: GUID(3, 2),
      teamId: teams[0].id,
      label: '2025–26 Demo',
      startDate: '2025-09-01',
      endDate: '2026-04-30',
    },
  ];
  const contacts: Contact[] = [
    {
      id: GUID(4, 1),
      type: 'customer',
      name: 'Alex Sample',
      company: 'Juniper Example Labs',
      email: 'alex@example.invalid',
      phone: '+1 202 555 0111',
      tier: 'gold',
      appActive: true,
      directoryActive: true,
      directoryId: null,
    },
    {
      id: GUID(4, 2),
      type: 'customer',
      name: 'Quinn Sample',
      company: 'Juniper Example Labs',
      email: 'quinn@example.invalid',
      phone: '+1 202 555 0112',
      tier: 'gold',
      appActive: true,
      directoryActive: true,
      directoryId: null,
    },
    {
      id: GUID(4, 3),
      type: 'customer',
      name: 'Robin Example',
      company: 'Cobalt Sample Studio',
      email: 'robin@example.invalid',
      phone: '+1 202 555 0113',
      tier: 'prospect',
      appActive: true,
      directoryActive: true,
      directoryId: null,
    },
    ...DIRECTORY.map(
      (entry, i): Contact => ({
        id: GUID(4, i + 4),
        type: 'employee',
        name: entry.name,
        company: 'Synthetic Demo',
        email: entry.email,
        phone: entry.phone,
        tier: 'bronze',
        appActive: true,
        directoryActive: entry.active,
        directoryId: entry.id,
      }),
    ),
  ];
  const games: Inventory[] = [
    {
      id: GUID(5, 1),
      kind: 'game',
      title: 'Synthetic Comets · Example Rivals',
      seasonId: seasons[0].id,
      gameDate: '2026-11-05T03:00:00Z',
      totalTickets: 4,
      status: 'scheduled',
      release: 'private',
      releaseAt: null,
    },
    {
      id: GUID(5, 2),
      kind: 'game',
      title: 'Synthetic Comets · Sample Visitors',
      seasonId: seasons[0].id,
      gameDate: '2026-12-09T03:00:00Z',
      totalTickets: 4,
      status: 'scheduled',
      release: 'released',
      releaseAt: null,
    },
    {
      id: GUID(5, 3),
      kind: 'event',
      title: 'Synthetic Winter Performance',
      seasonId: null,
      gameDate: '2026-12-15T02:00:00Z',
      totalTickets: 4,
      status: 'scheduled',
      release: 'private',
      releaseAt: null,
    },
    {
      id: GUID(5, 4),
      kind: 'game',
      title: 'Past Demo Night',
      seasonId: seasons[0].id,
      gameDate: '2026-10-01T02:00:00Z',
      totalTickets: 4,
      status: 'completed',
      release: 'private',
      releaseAt: null,
    },
    {
      id: GUID(5, 5),
      kind: 'game',
      title: 'Previous Season Example',
      seasonId: seasons[1].id,
      gameDate: '2026-03-01T02:00:00Z',
      totalTickets: 4,
      status: 'completed',
      release: 'private',
      releaseAt: null,
    },
  ];
  const seats = games.flatMap((g, gi) =>
    Array.from({ length: g.totalTickets }, (_, i) => ({
      id: GUID(6, gi * 100 + i + 1),
      gameId: g.id,
      label: `Ticket ${i + 1}`,
      status: (gi >= 3 && i === 0 ? 'assigned' : 'available') as
        | 'available'
        | 'assigned',
    })),
  );
  const requests: ReviewState['requests'] = [0, 3, 4].map((gi, i) => ({
    id: GUID(7, i + 1),
    gameId: games[gi].id,
    requesterId: PERSONAS.rep.id,
    recordedBy: PERSONAS.coordinator.id,
    purpose: 'customer',
    contactIds: [contacts[0].id],
    quantity: i === 0 ? 2 : 1,
    rationale: 'Discuss a synthetic renewal opportunity.',
    opportunity: 'Example renewal discussion',
    status: i === 0 ? 'submitted' : 'fulfilled',
    createdAt: '2026-10-23T12:00:00Z',
  }));
  const allocations: ReviewState['allocations'] = [3, 4].map((gi, i) => ({
    id: GUID(8, i + 1),
    requestId: requests[i + 1].id,
    gameId: games[gi].id,
    seatId: seats.find((s) => s.gameId === games[gi].id)!.id,
    contactId: contacts[0].id,
    status: 'approved',
    decision: 'Synthetic historical allocation',
    decidedBy: PERSONAS.coordinator.id,
    transferReference: '',
    outcome: i === 0 ? 'unknown' : 'attended',
    evidence: i === 0 ? '' : 'Synthetic prior-season attendance confirmation',
  }));
  return {
    teams,
    seasons,
    games,
    seats,
    contacts,
    requests,
    allocations,
    attendanceHistory: [
      {
        assignmentId: allocations[1].id,
        outcome: 'attended',
        evidence: allocations[1].evidence,
        recordedAt: '2026-03-02T12:00:00Z',
        recordedBy: PERSONAS.coordinator.id,
      },
    ],
    outbox: [],
    followup: {
      enabled: false,
      subject: 'How was the event?',
      body: 'Please confirm whether you attended. A photo is optional and not required. No reply leaves attendance unknown.',
    },
    scoring: {
      weights: {
        strategicValue: 0.35,
        attendanceRate: 0,
        reliability: 0.15,
        salesOpportunity: 0.25,
        fairness: 0.25,
        employeeCustomerBalance: 0,
        leadTime: 0,
        premiumDemandBalance: 0,
      },
      category: { customer: 0.8, prospect: 0.7, employee: 0.2 },
    },
  };
}
