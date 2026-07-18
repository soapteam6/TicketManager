import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Assignment, Game, Reservation, Seat, TicketRequest } from '@/lib/types';
import { pickArray, pickObject } from '@/lib/unwrap';
import { formatDate, formatUsd } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState, ErrorNote } from '@/components/QueryState';
import { StatCard } from '@/components/StatCard';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Field, TextInput, Select } from '@/components/Field';
import { RoleGate } from '@/auth/AuthContext';
import { RankingPanel } from './game/RankingPanel';
import { AttendanceModal } from './game/AttendanceModal';

// Statuses where an assignment is actively holding a seat.
const ACTIVE = ['proposed', 'approved', 'transferred'];

// Display labels for recorded attendance outcomes.
const ATTENDANCE_LABELS: Record<string, string> = {
  attended: 'Attended',
  no_show: 'No-show',
  cancelled: 'Cancelled',
};

// Reservation status → badge tone + label.
const RES_META: Record<string, { tone: 'amber' | 'green' | 'zinc' | 'red'; label: string }> = {
  offered: { tone: 'amber', label: 'Offered' },
  reserved: { tone: 'green', label: 'Reserved' },
  expired: { tone: 'red', label: 'Expired' },
  released: { tone: 'zinc', label: 'Released' },
};

export function GameDetailPage() {
  const { id } = useParams<{ id: string }>();
  const gameId = Number(id);
  const qc = useQueryClient();

  const [showSeats, setShowSeats] = useState(false);
  const [showReserve, setShowReserve] = useState(false);
  const [attendanceFor, setAttendanceFor] = useState<Assignment | null>(null);
  const [assignFor, setAssignFor] = useState<TicketRequest | null>(null);

  const gameQ = useQuery({
    queryKey: ['game', gameId],
    queryFn: async () => pickObject<Game>((await api.get(`/games/${gameId}`)).data, 'game'),
  });

  const seatsQ = useQuery({
    queryKey: ['game', gameId, 'seats'],
    queryFn: async () => pickArray<Seat>((await api.get(`/games/${gameId}/seats`)).data, 'seats'),
  });

  const requestsQ = useQuery({
    queryKey: ['game', gameId, 'requests'],
    queryFn: async () =>
      pickArray<TicketRequest>((await api.get('/requests', { params: { gameId } })).data, 'requests'),
  });

  const assignmentsQ = useQuery({
    queryKey: ['game', gameId, 'assignments'],
    queryFn: async () => {
      try {
        const res = await api.get(`/games/${gameId}/assignments`);
        return pickArray<Assignment>(res.data, 'assignments');
      } catch {
        return [] as Assignment[];
      }
    },
  });

  const reservationsQ = useQuery({
    queryKey: ['game', gameId, 'reservations'],
    queryFn: async () => pickArray<Reservation>((await api.get(`/games/${gameId}/reservations`)).data, 'reservations'),
  });

  const game = gameQ.data;

  const invalidateGame = () => {
    qc.invalidateQueries({ queryKey: ['game', gameId] });
    qc.invalidateQueries({ queryKey: ['dashboards'] });
  };

  const availableSeatList = seatsQ.data?.filter((s) => s.status === 'available') ?? [];
  const availableSeats = availableSeatList.length;
  const totalSeats = seatsQ.data?.length ?? game?.totalSeats ?? 0;

  // Available seats grouped by ticket type (Standard, VIP Suite, …).
  const availableByType = new Map<string, Seat[]>();
  for (const s of availableSeatList) {
    const t = s.ticketType || 'Standard';
    (availableByType.get(t) ?? availableByType.set(t, []).get(t)!).push(s);
  }
  const availableTypes = [...availableByType.keys()];

  const assignedCountFor = (requestId: number) =>
    (assignmentsQ.data ?? []).filter((a) => a.requestId === requestId && ACTIVE.includes(a.status)).length;

  // Assign the next available seats of the chosen type — no per-seat picking.
  const assign = useMutation({
    mutationFn: async ({ request, ticketType }: { request: TicketRequest; ticketType?: string }) => {
      const outstanding = request.quantity - assignedCountFor(request.id);
      const pool = ticketType ? availableByType.get(ticketType) ?? [] : availableSeatList;
      if (pool.length === 0) throw new Error('No available seats of that type. Use “Add seats” first.');
      for (const seat of pool.slice(0, outstanding)) {
        await api.post('/assignments', { requestId: request.id, seatId: seat.id });
      }
    },
    onSuccess: () => {
      invalidateGame();
      setAssignFor(null);
    },
  });

  // Unassign: release the seat back into the available pool.
  const unassign = useMutation({
    mutationFn: async (assignmentId: number) => (await api.post(`/assignments/${assignmentId}/decline`, {})).data,
    onSuccess: invalidateGame,
  });

  const claimReservation = useMutation({
    mutationFn: async (id: number) => (await api.post(`/reservations/${id}/claim`, {})).data,
    onSuccess: invalidateGame,
  });
  const releaseReservation = useMutation({
    mutationFn: async (id: number) => (await api.post(`/reservations/${id}/release`, {})).data,
    onSuccess: invalidateGame,
  });

  const requestColumns: Column<TicketRequest>[] = [
    {
      key: 'requester',
      header: 'Requester',
      render: (r) => (
        <div>
          <div className="font-medium text-slate-900">{r.requesterName ?? `Contact #${r.beneficiaryContactId ?? '—'}`}</div>
          <div className="text-xs text-slate-400">{r.requesterCompany ?? r.requesterEmail ?? ''}</div>
        </div>
      ),
    },
    { key: 'type', header: 'For', render: (r) => <Badge tone="slate">{r.beneficiaryType}</Badge> },
    { key: 'qty', header: 'Qty', align: 'right', render: (r) => r.quantity },
    { key: 'sales', header: 'Sales opp', align: 'right', render: (r) => formatUsd(r.salesOpportunityUsd) },
    { key: 'score', header: 'Score', align: 'right', render: (r) => (r.priorityScore != null ? r.priorityScore.toFixed(3) : '—') },
    {
      key: 'assigned',
      header: 'Seats',
      align: 'right',
      render: (r) => `${assignedCountFor(r.id)}/${r.quantity}`,
    },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => {
        const outstanding = r.quantity - assignedCountFor(r.id);
        if (r.status === 'cancelled' || r.status === 'declined' || outstanding <= 0) return null;
        return (
          <RoleGate roles={['admin']}>
            <Button
              size="sm"
              variant="secondary"
              disabled={availableSeats === 0}
              loading={assign.isPending && assign.variables?.request.id === r.id}
              onClick={() => {
                // One type → assign straight away; multiple → let the admin pick which.
                if (availableTypes.length <= 1) assign.mutate({ request: r, ticketType: availableTypes[0] });
                else setAssignFor(r);
              }}
            >
              Assign {outstanding} seat{outstanding > 1 ? 's' : ''}
            </Button>
          </RoleGate>
        );
      },
    },
  ];

  const assignmentColumns: Column<Assignment>[] = [
    {
      key: 'beneficiary',
      header: 'Beneficiary',
      render: (a) => <span className="font-medium text-slate-800">{a.requesterName ?? `Request #${a.requestId}`}</span>,
    },
    { key: 'seat', header: 'Seat', render: (a) => a.seatLabel ?? `Seat #${a.seatId}` },
    { key: 'ticketType', header: 'Type', render: (a) => <Badge tone="slate">{a.ticketType ?? 'Standard'}</Badge> },
    {
      key: 'status',
      header: 'Status',
      // Once reconciled, show the attendance outcome; otherwise a held seat reads as "Assigned".
      render: (a) =>
        a.attendanceStatus ? (
          <Badge status={a.attendanceStatus}>{ATTENDANCE_LABELS[a.attendanceStatus] ?? undefined}</Badge>
        ) : (
          <Badge status={a.status}>{a.status === 'approved' ? 'Assigned' : undefined}</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (a) => {
        if (!ACTIVE.includes(a.status)) return null;
        return (
          <RoleGate roles={['admin']}>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setAttendanceFor(a)}>
                {a.attendanceStatus ? 'Edit attendance' : 'Record attendance'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={unassign.isPending && unassign.variables === a.id}
                onClick={() => unassign.mutate(a.id)}
              >
                Unassign
              </Button>
            </div>
          </RoleGate>
        );
      },
    },
  ];

  const now = Date.now();
  const reservationColumns: Column<Reservation>[] = [
    {
      key: 'person',
      header: 'Person',
      render: (r) => (
        <div>
          <div className="font-medium text-slate-800">{r.personName}</div>
          {r.personEmail && <div className="text-xs text-slate-400">{r.personEmail}</div>}
        </div>
      ),
    },
    { key: 'seat', header: 'Seat', render: (r) => r.seatLabel ?? `Seat #${r.seatId}` },
    { key: 'type', header: 'Type', render: (r) => <Badge tone="slate">{r.ticketType ?? 'Standard'}</Badge> },
    {
      key: 'expires',
      header: 'Reserve by',
      render: (r) =>
        r.status === 'offered' ? (
          <span className={r.expiresAt < now ? 'text-rose-600' : 'text-slate-600'}>{formatDate(r.expiresAt)}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={RES_META[r.status]?.tone ?? 'slate'}>{RES_META[r.status]?.label ?? r.status}</Badge> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => {
        if (r.status !== 'offered' && r.status !== 'reserved') return null;
        return (
          <RoleGate roles={['admin']}>
            <div className="flex justify-end gap-2">
              {r.status === 'offered' && (
                <Button size="sm" variant="success" loading={claimReservation.isPending && claimReservation.variables === r.id} onClick={() => claimReservation.mutate(r.id)}>
                  Mark reserved
                </Button>
              )}
              <Button size="sm" variant="secondary" loading={releaseReservation.isPending && releaseReservation.variables === r.id} onClick={() => releaseReservation.mutate(r.id)}>
                Release
              </Button>
            </div>
          </RoleGate>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title={game ? (game.kind === 'event' ? game.title ?? game.opponent : `vs ${game.opponent}`) : 'Game'}
        breadcrumbs={
          game?.kind === 'event' ? (
            <Link to="/events" className="hover:text-slate-700">Events</Link>
          ) : game?.seasonId ? (
            <Link to={`/seasons/${game.seasonId}`} className="hover:text-slate-700">
              {game.seasonLabel ?? 'Season'}
            </Link>
          ) : (
            <Link to="/games" className="hover:text-slate-700">Games</Link>
          )
        }
        subtitle={game ? (game.kind === 'event' ? `Custom event · ${formatDate(game.gameDate)}` : `${game.teamName ?? ''} · ${formatDate(game.gameDate)}`) : undefined}
        actions={
          game && (
            <>
              <Badge status={game.status} />
              <RoleGate roles={['admin']}>
                <Button variant="secondary" onClick={() => setShowSeats(true)}>Add seats</Button>
                <Button variant="secondary" disabled={availableSeats === 0} onClick={() => setShowReserve(true)}>Reserve seats</Button>
              </RoleGate>
            </>
          )
        }
      />

      <ErrorNote error={assign.error || unassign.error || claimReservation.error || releaseReservation.error} />

      <QueryState isLoading={gameQ.isLoading} error={gameQ.error}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Total seats" value={totalSeats} tone="brand" />
          <StatCard label="Available seats" value={availableSeats} tone="emerald" />
          <StatCard label="Open requests" value={requestsQ.data?.length ?? 0} tone="amber" />
        </div>

        {availableTypes.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span className="font-medium uppercase tracking-wide">Available by type:</span>
            {[...availableByType.entries()].map(([t, list]) => (
              <span key={t} className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">
                {t}: <b className="text-slate-800">{list.length}</b>
              </span>
            ))}
          </div>
        )}

        {game?.kind === 'event' && game.description && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
            <span className="font-medium text-slate-700">Description:</span> {game.description}
          </div>
        )}
        {game?.promotions && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
            <span className="font-medium text-slate-700">Promotions:</span> {game.promotions}
          </div>
        )}

        <div className="mt-6">
          <RankingPanel gameId={gameId} onScored={() => qc.invalidateQueries({ queryKey: ['game', gameId, 'requests'] })} />
        </div>

        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">Requests</h3>
          <QueryState isLoading={requestsQ.isLoading} error={requestsQ.error}>
            <DataTable columns={requestColumns} rows={requestsQ.data} keyFn={(r) => r.id} emptyTitle="No requests for this game" />
          </QueryState>
        </div>

        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">Assignments</h3>
          <DataTable
            columns={assignmentColumns}
            rows={assignmentsQ.data}
            keyFn={(a) => a.id}
            loading={assignmentsQ.isLoading}
            emptyTitle="No assignments yet"
            emptyDescription="Add seats, then use “Assign” on a request to hand out tickets."
          />
        </div>

        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">Reservations</h3>
          <DataTable
            columns={reservationColumns}
            rows={reservationsQ.data}
            keyFn={(r) => r.id}
            loading={reservationsQ.isLoading}
            emptyTitle="No reservations"
            emptyDescription="Use “Reserve seats” to hold seats for a person until a deadline."
          />
        </div>
      </QueryState>

      {showSeats && <AddSeatsModal gameId={gameId} onClose={() => setShowSeats(false)} />}
      {showReserve && (
        <ReserveModal
          gameId={gameId}
          availableTypes={availableTypes}
          onClose={() => setShowReserve(false)}
          onDone={() => {
            invalidateGame();
            setShowReserve(false);
          }}
        />
      )}
      {attendanceFor && (
        <AttendanceModal assignment={attendanceFor} gameId={gameId} onClose={() => setAttendanceFor(null)} />
      )}
      {assignFor && (
        <TicketTypeChooser
          request={assignFor}
          outstanding={assignFor.quantity - assignedCountFor(assignFor.id)}
          availableByType={availableByType}
          pending={assign.isPending}
          error={assign.error}
          onPick={(ticketType) => assign.mutate({ request: assignFor, ticketType })}
          onClose={() => setAssignFor(null)}
        />
      )}
    </div>
  );
}

// Pick which ticket type to draw from when a game's pool holds more than one.
function TicketTypeChooser({
  request,
  outstanding,
  availableByType,
  pending,
  error,
  onPick,
  onClose,
}: {
  request: TicketRequest;
  outstanding: number;
  availableByType: Map<string, Seat[]>;
  pending: boolean;
  error: unknown;
  onPick: (ticketType: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Choose ticket type"
      description={`Assign ${outstanding} seat${outstanding > 1 ? 's' : ''} to ${request.requesterName ?? `Request #${request.id}`}.`}
      footer={<Button variant="secondary" onClick={onClose}>Cancel</Button>}
    >
      <div className="space-y-2">
        {[...availableByType.entries()].map(([type, list]) => (
          <button
            key={type}
            type="button"
            disabled={pending || list.length === 0}
            onClick={() => onPick(type)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-left transition hover:border-brand-400 hover:bg-slate-50 disabled:opacity-50"
          >
            <span className="font-medium text-slate-800">{type}</span>
            <span className="text-sm text-slate-500">
              {list.length} available · assigns {Math.min(outstanding, list.length)}
            </span>
          </button>
        ))}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

// Grow the seat pool by a simple count of available seats.
function AddSeatsModal({ gameId, onClose }: { gameId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [count, setCount] = useState('4');
  const [ticketType, setTicketType] = useState('Standard');

  const create = useMutation({
    mutationFn: async () =>
      (await api.post(`/games/${gameId}/seats`, { count: Number(count), ticketType: ticketType.trim() || 'Standard' })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['game', gameId] });
      onClose();
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add seats"
      description="Add available seats of a ticket type to this game's pool."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-seats" loading={create.isPending}>Add seats</Button>
        </>
      }
    >
      <form id="add-seats" onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Number of seats" required>
            <TextInput type="number" min="1" value={count} onChange={(e) => setCount(e.target.value)} required />
          </Field>
          <Field label="Ticket type" hint="e.g. Standard, VIP Suite">
            <TextInput value={ticketType} onChange={(e) => setTicketType(e.target.value)} placeholder="Standard" />
          </Field>
        </div>
        <ErrorNote error={create.error} />
      </form>
    </Modal>
  );
}

// Offer seats to a named person with a deadline to confirm before they return to the pool.
function ReserveModal({
  gameId,
  availableTypes,
  onClose,
  onDone,
}: {
  gameId: number;
  availableTypes: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [personName, setPersonName] = useState('');
  const [personEmail, setPersonEmail] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [ticketType, setTicketType] = useState('');
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/games/${gameId}/reservations`, {
          personName: personName.trim(),
          personEmail: personEmail.trim() || undefined,
          quantity: Number(quantity),
          ticketType: ticketType || undefined,
          expiresAt,
        })
      ).data,
    onSuccess: onDone,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Reserve seats"
      description="Hold seats for a person until a deadline. Unclaimed seats return to the pool automatically."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="reserve" loading={create.isPending} disabled={!personName.trim() || !expiresAt}>
            Reserve
          </Button>
        </>
      }
    >
      <form id="reserve" onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Person" required>
            <TextInput value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Jane Smith" required />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={personEmail} onChange={(e) => setPersonEmail(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Number of seats" required>
            <TextInput type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </Field>
          {availableTypes.length > 1 ? (
            <Field label="Ticket type">
              <Select value={ticketType} onChange={(e) => setTicketType(e.target.value)}>
                <option value="">Any available</option>
                {availableTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
          ) : (
            <div />
          )}
        </div>
        <Field label="Reserve by" required hint="Seats are released back to the pool after this date">
          <TextInput type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} required />
        </Field>
        <ErrorNote error={create.error} />
      </form>
    </Modal>
  );
}

// Default the reserve-by date to one week out (YYYY-MM-DD).
function defaultExpiry(): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
