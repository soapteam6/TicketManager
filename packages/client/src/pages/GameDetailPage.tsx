import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Assignment, Game, Seat, TicketRequest } from '@/lib/types';
import { pickArray, pickObject } from '@/lib/unwrap';
import { formatDate, formatUsd } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState, ErrorNote } from '@/components/QueryState';
import { StatCard } from '@/components/StatCard';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Field, TextInput } from '@/components/Field';
import { RoleGate } from '@/auth/AuthContext';
import { RankingPanel } from './game/RankingPanel';
import { AttendanceModal } from './game/AttendanceModal';

export function GameDetailPage() {
  const { id } = useParams<{ id: string }>();
  const gameId = Number(id);
  const qc = useQueryClient();

  const [showSeats, setShowSeats] = useState(false);
  const [attendanceFor, setAttendanceFor] = useState<Assignment | null>(null);
  const [assignFor, setAssignFor] = useState<TicketRequest | null>(null);
  const [reassign, setReassign] = useState<Assignment | null>(null);

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
    // The assignments list is returned alongside the game or via a dedicated route;
    // try the nested game payload first, then a fallback endpoint.
    queryFn: async () => {
      try {
        const res = await api.get(`/games/${gameId}/assignments`);
        return pickArray<Assignment>(res.data, 'assignments');
      } catch {
        return [] as Assignment[];
      }
    },
  });

  const game = gameQ.data;

  const invalidateGame = () => {
    qc.invalidateQueries({ queryKey: ['game', gameId] });
    qc.invalidateQueries({ queryKey: ['dashboards'] });
  };

  const recommend = useMutation({
    mutationFn: async () => (await api.post(`/games/${gameId}/assignments/recommend`, {})).data,
    onSuccess: invalidateGame,
  });

  const transfer = useMutation({
    mutationFn: async () => (await api.post(`/games/${gameId}/transfer`, {})).data,
    onSuccess: invalidateGame,
  });

  const approve = useMutation({
    mutationFn: async (assignmentId: number) => (await api.post(`/assignments/${assignmentId}/approve`, {})).data,
    onSuccess: invalidateGame,
  });

  const decline = useMutation({
    mutationFn: async (assignmentId: number) => (await api.post(`/assignments/${assignmentId}/decline`, {})).data,
    onSuccess: invalidateGame,
  });

  const availableSeats = seatsQ.data?.filter((s) => s.status === 'available').length ?? 0;
  const totalSeats = seatsQ.data?.length ?? game?.totalSeats ?? 0;

  const ACTIVE = ['proposed', 'approved', 'transferred'];
  const assignedCountFor = (requestId: number) =>
    (assignmentsQ.data ?? []).filter((a) => a.requestId === requestId && ACTIVE.includes(a.status)).length;

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
            <Button size="sm" variant="secondary" onClick={() => setAssignFor(r)}>Assign seats</Button>
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
    { key: 'status', header: 'Status', render: (a) => <Badge status={a.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (a) => (
        <RoleGate roles={['admin']}>
          <div className="flex justify-end gap-2">
            {a.status === 'proposed' && (
              <Button size="sm" variant="success" loading={approve.isPending && approve.variables === a.id} onClick={() => approve.mutate(a.id)}>
                Approve
              </Button>
            )}
            {(a.status === 'proposed' || a.status === 'approved') && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setReassign(a)}>Change seat</Button>
                <Button size="sm" variant="secondary" loading={decline.isPending && decline.variables === a.id} onClick={() => decline.mutate(a.id)}>
                  Decline
                </Button>
              </>
            )}
            {a.status === 'transferred' && (
              <Button size="sm" variant="secondary" onClick={() => setAttendanceFor(a)}>
                Reconcile
              </Button>
            )}
          </div>
        </RoleGate>
      ),
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
                <Button variant="secondary" loading={recommend.isPending} onClick={() => recommend.mutate()}>
                  Recommend assignments
                </Button>
                <Button loading={transfer.isPending} onClick={() => transfer.mutate()}>
                  Transfer approved
                </Button>
              </RoleGate>
            </>
          )
        }
      />

      <ErrorNote error={recommend.error || transfer.error || approve.error || decline.error} />

      <QueryState isLoading={gameQ.isLoading} error={gameQ.error}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Total seats" value={totalSeats} tone="brand" />
          <StatCard label="Available seats" value={availableSeats} tone="emerald" />
          <StatCard label="Open requests" value={requestsQ.data?.length ?? 0} tone="amber" />
        </div>

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
            emptyDescription="Use “Recommend assignments” to propose seats for top-ranked requests."
          />
        </div>
      </QueryState>

      {showSeats && <AddSeatsModal gameId={gameId} onClose={() => setShowSeats(false)} />}
      {attendanceFor && (
        <AttendanceModal assignment={attendanceFor} gameId={gameId} onClose={() => setAttendanceFor(null)} />
      )}
      {assignFor && (
        <SeatPickerModal
          gameId={gameId}
          title={`Assign seats — ${assignFor.requesterName ?? `Request #${assignFor.id}`}`}
          description={`Choose up to ${assignFor.quantity - assignedCountFor(assignFor.id)} seat(s) for this request.`}
          max={assignFor.quantity - assignedCountFor(assignFor.id)}
          confirmLabel="Assign selected"
          onConfirm={async (seatIds) => {
            for (const seatId of seatIds) await api.post('/assignments', { requestId: assignFor.id, seatId });
          }}
          onDone={() => {
            invalidateGame();
            setAssignFor(null);
          }}
          onClose={() => setAssignFor(null)}
        />
      )}
      {reassign && (
        <SeatPickerModal
          gameId={gameId}
          title="Change seat"
          description="Pick the seat to move this assignment to."
          max={1}
          confirmLabel="Move to seat"
          onConfirm={async (seatIds) => {
            await api.post(`/assignments/${reassign.id}/reassign`, { toSeatId: seatIds[0] });
          }}
          onDone={() => {
            invalidateGame();
            setReassign(null);
          }}
          onClose={() => setReassign(null)}
        />
      )}
    </div>
  );
}

// Pick specific available seats (grouped by section & row) to assign or reassign.
function SeatPickerModal({
  gameId,
  title,
  description,
  max,
  confirmLabel,
  onConfirm,
  onDone,
  onClose,
}: {
  gameId: number;
  title: string;
  description: string;
  max: number;
  confirmLabel: string;
  onConfirm: (seatIds: number[]) => Promise<void>;
  onDone: () => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);

  const seatsQ = useQuery({
    queryKey: ['game', gameId, 'available-seats'],
    queryFn: async () => pickArray<Seat>((await api.get(`/games/${gameId}/seats`, { params: { status: 'available' } })).data, 'seats'),
  });

  const confirm = useMutation({
    mutationFn: async () => onConfirm(selected),
    onSuccess: onDone,
  });

  function toggle(id: number) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (max === 1) return [id];
      if (prev.length >= max) return prev;
      return [...prev, id];
    });
  }

  // Group seats: section -> row -> seats.
  const groups = new Map<string, Seat[]>();
  for (const s of seatsQ.data ?? []) {
    const key = `${s.section} · Row ${s.row}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={confirm.isPending} disabled={selected.length === 0} onClick={() => confirm.mutate()}>
            {confirmLabel} ({selected.length})
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <QueryState isLoading={seatsQ.isLoading} error={seatsQ.error}>
          {(seatsQ.data?.length ?? 0) === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              No available seats. Use “Add seats” to create inventory (section, row, seat range) first.
            </div>
          ) : (
            <div className="max-h-80 space-y-4 overflow-auto">
              {[...groups.entries()].map(([label, list]) => (
                <div key={label}>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((s) => {
                      const on = selected.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggle(s.id)}
                          className={`h-9 min-w-9 rounded-md border px-2 text-sm font-medium transition ${
                            on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-brand-400'
                          }`}
                          title={`${s.section} ${s.row}-${s.seatNumber}`}
                        >
                          {s.seatNumber}
                          {s.isAda ? ' ♿' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </QueryState>
        <ErrorNote error={confirm.error} />
      </div>
    </Modal>
  );
}

function AddSeatsModal({ gameId, onClose }: { gameId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [section, setSection] = useState('');
  const [row, setRow] = useState('');
  const [fromSeat, setFromSeat] = useState('1');
  const [toSeat, setToSeat] = useState('4');

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/games/${gameId}/seats`, {
          section,
          row,
          fromSeat: Number(fromSeat),
          toSeat: Number(toSeat),
        })
      ).data,
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
      description="Bulk-create a contiguous seat range for this game."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-seats" loading={create.isPending}>Add seats</Button>
        </>
      }
    >
      <form id="add-seats" onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Section" required>
            <TextInput value={section} onChange={(e) => setSection(e.target.value)} placeholder="114" required />
          </Field>
          <Field label="Row" required>
            <TextInput value={row} onChange={(e) => setRow(e.target.value)} placeholder="C" required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From seat" required>
            <TextInput type="number" min="1" value={fromSeat} onChange={(e) => setFromSeat(e.target.value)} required />
          </Field>
          <Field label="To seat" required>
            <TextInput type="number" min="1" value={toSeat} onChange={(e) => setToSeat(e.target.value)} required />
          </Field>
        </div>
        <ErrorNote error={create.error} />
      </form>
    </Modal>
  );
}
