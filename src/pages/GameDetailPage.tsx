import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import { Cr9cd_ticketrequestsService } from '../generated/services/Cr9cd_ticketrequestsService';
import { Cr9cd_assignmentsService } from '../generated/services/Cr9cd_assignmentsService';
import { Cr9cd_seasonsService } from '../generated/services/Cr9cd_seasonsService';
import type { Cr9cd_games } from '../generated/models/Cr9cd_gamesModel';
import type { Cr9cd_seasons } from '../generated/models/Cr9cd_seasonsModel';
import type { Cr9cd_seats } from '../generated/models/Cr9cd_seatsModel';
import { Cr9cd_reservationsService } from '../generated/services/Cr9cd_reservationsService';
import type { Cr9cd_reservations } from '../generated/models/Cr9cd_reservationsModel';
import type { Cr9cd_ticketrequests } from '../generated/models/Cr9cd_ticketrequestsModel';
import type { Cr9cd_assignments } from '../generated/models/Cr9cd_assignmentsModel';
import { bindRef } from '../dataverse/bind';
import {
  seatStatusChoice,
  requestStatusChoice,
  contactTypeChoice,
  assignmentStatusChoice,
  gameStatusChoice,
  gameKindChoice,
  reservationStatusChoice,
} from '../dataverse/choiceMaps';
import { scoreGame } from '../services/scoringService';
import {
  assignOutstandingTickets,
  approveAssignment,
  declineAssignment,
  deleteAssignment,
  recommendForGame,
  reconcileOrphanSeats,
} from '../services/assignmentsService';
import { deleteRequest } from '../services/requestsService';
import { deleteGame, countGameDependents } from '../services/gamesService';
import { recordAttendance } from '../services/attendanceService';
import { createReservations, claimReservation, releaseReservation, expireDueReservations } from '../services/reservationsService';
import { transferGame } from '../services/transferService';
import ContactPicker, { type ContactSelection } from '../components/ContactPicker';
import CrmPicker from '../components/CrmPicker';
import { upsertBeneficiaryFromCrmContact } from '../services/crmService';
import type { GameRankingResult } from '../domain/scoring-types';
import type { ContactType, GameStatus, GameKind, AttendanceOutcome, ReservationStatus } from '../domain/enums';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Badge, type BadgeTone } from '../components/Badge';
import { TextInput, Select, Field } from '../components/Field';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';

const thClass = 'whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500';
const tdClass = 'px-4 py-3 align-top text-sm text-slate-700';

const RESERVATION_TONE: Record<ReservationStatus, BadgeTone> = {
  offered: 'amber',
  reserved: 'green',
  expired: 'red',
  released: 'zinc',
};

export default function GameDetailPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [game, setGame] = useState<Cr9cd_games | null>(null);
  const [seats, setSeats] = useState<Cr9cd_seats[]>([]);
  const [requests, setRequests] = useState<Cr9cd_ticketrequests[]>([]);
  const [assignments, setAssignments] = useState<Cr9cd_assignments[]>([]);
  const [reservations, setReservations] = useState<Cr9cd_reservations[]>([]);
  const [ranking, setRanking] = useState<GameRankingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [editingGame, setEditingGame] = useState(false);
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [showReserve, setShowReserve] = useState(false);

  const load = useCallback(async () => {
    if (!gameId) return;
    // Lazy-expire overdue reservations first so freed seats show as available in this load.
    await expireDueReservations(gameId);
    const [gameResult, seatsResult, requestsResult, assignmentsResult, reservationsResult] = await Promise.all([
      Cr9cd_gamesService.get(gameId),
      Cr9cd_seatsService.getAll({ filter: `_cr9cd_game_value eq ${gameId}`, orderBy: ['cr9cd_section asc', 'cr9cd_seat_number asc'] }),
      Cr9cd_ticketrequestsService.getAll({ filter: `_cr9cd_game_value eq ${gameId}`, orderBy: ['cr9cd_priority_rank asc'] }),
      Cr9cd_assignmentsService.getAll({ filter: `_cr9cd_game_value eq ${gameId}` }),
      Cr9cd_reservationsService.getAll({ filter: `_cr9cd_game_value eq ${gameId}`, orderBy: ['createdon desc'] }),
    ]);
    setGame(gameResult.data ?? null);
    setSeats(seatsResult.data ?? []);
    setRequests(requestsResult.data ?? []);
    setAssignments(assignmentsResult.data ?? []);
    setReservations(reservationsResult.data ?? []);
  }, [gameId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!gameId) return null;
  if (!game) {
    return (
      <div className="card flex items-center justify-center p-12">
        <Spinner label="Loading…" />
      </div>
    );
  }

  const availableSeats = seats.filter((s) => s.cr9cd_status != null && seatStatusChoice.toValue(s.cr9cd_status) === 'available');
  const availableByType = Object.entries(
    availableSeats.reduce<Record<string, number>>((acc, s) => {
      const t = s.cr9cd_ticket_type || 'Standard';
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => a[0].localeCompare(b[0]));
  const assignmentsByRequest = new Map<string, Cr9cd_assignments[]>();
  for (const a of assignments) {
    const reqId = a._cr9cd_ticket_request_value;
    if (!reqId) continue;
    const list = assignmentsByRequest.get(reqId) ?? [];
    list.push(a);
    assignmentsByRequest.set(reqId, list);
  }
  const activeAssignmentStatuses = new Set(['proposed', 'approved', 'transferred']);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-4">
        <Link to="/teams" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          &larr; Teams
        </Link>
      </p>
      {message && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{message}</div>}

      <div className="card mb-4 p-5">
        {editingGame ? (
          <EditGameForm
            game={game}
            onDone={() => {
              setEditingGame(false);
              load();
            }}
          />
        ) : (
          <>
            <PageHeader
              title={
                <>
                  {game.cr9cd_game_date ? new Date(game.cr9cd_game_date).toLocaleDateString() : ''}{' '}
                  {(game.cr9cd_kind != null ? gameKindChoice.toValue(game.cr9cd_kind) : 'game') === 'event'
                    ? game.cr9cd_title
                    : `vs ${game.cr9cd_opponent}`}
                </>
              }
              subtitle={
                game.cr9cd_seasonname
                  ? [game.cr9cd_seasonname, game.cr9cd_promotions].filter(Boolean).join(' · ')
                  : game.cr9cd_promotions || undefined
              }
              actions={
                <>
                  <Badge status={game.cr9cd_status != null ? gameStatusChoice.toValue(game.cr9cd_status) : 'scheduled'} />
                  <Button size="sm" variant="secondary" onClick={() => setEditingGame(true)}>
                    Edit game
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const counts = await countGameDependents(gameId);
                        const summary = `${counts.requests} request(s), ${counts.assignments} assignment(s), ${counts.seats} seat(s), ${counts.waitlistEntries} waitlist entr(y/ies), ${counts.attendanceRecords} attendance record(s)`;
                        if (!window.confirm(`Delete this game and everything tied to it — ${summary}? This cannot be undone.`)) return;
                        await deleteGame(gameId);
                        navigate('/teams');
                      })
                    }
                  >
                    Delete game
                  </Button>
                </>
              }
            />
          </>
        )}
      </div>

      <div className="card mb-4 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Seats <span className="font-normal text-slate-400">({availableSeats.length} available of {seats.length})</span>
        </h2>
        {availableByType.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {availableByType.map(([type, n]) => (
              <span key={type} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                {type}: {n}
              </span>
            ))}
          </div>
        )}
        <AddSeatsForm gameId={gameId} seats={seats} onCreated={load} />
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={thClass}>Ticket type</th>
                <th className={thClass}>Seat #</th>
                <th className={thClass}>Status</th>
                <th className={thClass}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {seats.map((s) => {
                const status = s.cr9cd_status != null ? seatStatusChoice.toValue(s.cr9cd_status) : 'available';
                return (
                  <tr key={s.cr9cd_seatid} className="hover:bg-slate-50">
                    <td className={tdClass}>{s.cr9cd_ticket_type || 'Standard'}</td>
                    <td className={tdClass}>{s.cr9cd_seat_number}</td>
                    <td className={tdClass}>
                      <Badge status={status} />
                    </td>
                    <td className={clsx(tdClass, 'text-right')}>
                      {status === 'available' && (
                        <button
                          className="text-xs font-medium text-rose-500 hover:text-rose-700"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              if (!window.confirm('Delete this seat?')) return;
                              await Cr9cd_seatsService.delete(s.cr9cd_seatid);
                            })
                          }
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {seats.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">
                    No seats yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mb-4 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Reservations</h2>
          <Button size="sm" variant="secondary" disabled={availableSeats.length === 0} onClick={() => setShowReserve(true)}>
            Reserve seats
          </Button>
        </div>
        {reservations.length === 0 ? (
          <p className="text-sm text-slate-400">No reservations yet — offer available seats to a named person with a deadline.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={thClass}>Person</th>
                  <th className={thClass}>Ticket type</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Reserve by</th>
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reservations.map((r) => {
                  const status = r.cr9cd_status != null ? reservationStatusChoice.toValue(r.cr9cd_status) : 'offered';
                  const active = status === 'offered' || status === 'reserved';
                  return (
                    <tr key={r.cr9cd_reservationid} className="hover:bg-slate-50">
                      <td className={tdClass}>
                        <div className="font-medium text-slate-900">{r.cr9cd_person_name}</div>
                        {r.cr9cd_person_email && <div className="text-xs text-slate-400">{r.cr9cd_person_email}</div>}
                      </td>
                      <td className={tdClass}>{r.cr9cd_ticket_type || 'Standard'}</td>
                      <td className={tdClass}>
                        <Badge tone={RESERVATION_TONE[status]}>{status[0].toUpperCase() + status.slice(1)}</Badge>
                      </td>
                      <td className={tdClass}>{r.cr9cd_expires_at ? new Date(r.cr9cd_expires_at).toLocaleDateString() : '—'}</td>
                      <td className={clsx(tdClass, 'text-right')}>
                        <div className="flex items-center justify-end gap-3">
                          {status === 'offered' && (
                            <button
                              className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
                              disabled={busy}
                              onClick={() => run(() => claimReservation(r.cr9cd_reservationid))}
                            >
                              Mark reserved
                            </button>
                          )}
                          {active && (
                            <button
                              className="text-xs font-medium text-rose-500 hover:text-rose-700"
                              disabled={busy}
                              onClick={() => run(() => releaseReservation(r.cr9cd_reservationid))}
                            >
                              Release
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showReserve && (
        <ReserveModal
          gameId={gameId}
          availableByType={availableByType}
          onClose={() => setShowReserve(false)}
          onReserved={() => {
            setShowReserve(false);
            load();
          }}
        />
      )}

      <div className="card mb-4 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Requests</h2>
        <NewRequestForm gameId={gameId} onCreated={load} />
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={thClass}>Requester</th>
                <th className={thClass}>Type</th>
                <th className={thClass}>Qty</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Rank</th>
                <th className={thClass}>Score</th>
                <th className={thClass}>Assignments</th>
                <th className={thClass}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requests.map((r) => {
                if (editingRequestId === r.cr9cd_ticketrequestid) {
                  return (
                    <EditRequestForm
                      key={r.cr9cd_ticketrequestid}
                      request={r}
                      onDone={() => {
                        setEditingRequestId(null);
                        load();
                      }}
                    />
                  );
                }
                const reqAssignments = (assignmentsByRequest.get(r.cr9cd_ticketrequestid) ?? []).filter(
                  (a) => a.cr9cd_status != null && activeAssignmentStatuses.has(assignmentStatusChoice.toValue(a.cr9cd_status))
                );
                const outstanding = (r.cr9cd_quantity ?? 1) - reqAssignments.length;
                return (
                  <tr key={r.cr9cd_ticketrequestid} className="hover:bg-slate-50">
                    <td className={clsx(tdClass, 'font-medium text-slate-900')}>{r.cr9cd_requester_name}</td>
                    <td className={tdClass}>
                      <Badge status={r.cr9cd_beneficiary_type != null ? contactTypeChoice.toValue(r.cr9cd_beneficiary_type) : undefined} />
                    </td>
                    <td className={clsx(tdClass, 'tabular-nums')}>{r.cr9cd_quantity}</td>
                    <td className={tdClass}>
                      <Badge status={r.cr9cd_status != null ? requestStatusChoice.toValue(r.cr9cd_status) : 'submitted'} />
                    </td>
                    <td className={clsx(tdClass, 'tabular-nums')}>{r.cr9cd_priority_rank ?? '—'}</td>
                    <td className={clsx(tdClass, 'tabular-nums')}>{r.cr9cd_priority_score != null ? r.cr9cd_priority_score.toFixed(3) : '—'}</td>
                    <td className={tdClass}>
                      <div className="space-y-1.5">
                        {reqAssignments.map((a) => (
                          <div key={a.cr9cd_assignmentid} className="flex flex-wrap items-center gap-1.5">
                            <Badge status={a.cr9cd_status != null ? assignmentStatusChoice.toValue(a.cr9cd_status) : 'proposed'} />
                            <span className="text-xs text-slate-400">{a.cr9cd_seatname}</span>
                            {a.cr9cd_status != null && assignmentStatusChoice.toValue(a.cr9cd_status) === 'proposed' && (
                              <button
                                className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
                                disabled={busy}
                                onClick={() => run(() => approveAssignment(a.cr9cd_assignmentid))}
                              >
                                Approve
                              </button>
                            )}
                            {a.cr9cd_status != null && ['proposed', 'approved'].includes(assignmentStatusChoice.toValue(a.cr9cd_status)) && (
                              <button
                                className="text-xs font-medium text-slate-500 hover:text-slate-700"
                                disabled={busy}
                                onClick={() => run(() => declineAssignment(a.cr9cd_assignmentid))}
                              >
                                Decline
                              </button>
                            )}
                            {a.cr9cd_status != null && assignmentStatusChoice.toValue(a.cr9cd_status) === 'approved' && (
                              <AttendanceForm assignmentId={a.cr9cd_assignmentid} onDone={load} />
                            )}
                            <button
                              className="text-xs font-medium text-rose-500 hover:text-rose-700"
                              disabled={busy}
                              title="Hard-delete this assignment (use for a mistaken entry, not a real decline)"
                              onClick={() =>
                                run(async () => {
                                  if (!window.confirm('Permanently delete this assignment? Use this for data-entry mistakes only.')) return;
                                  await deleteAssignment(a.cr9cd_assignmentid);
                                })
                              }
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className={clsx(tdClass, 'text-right')}>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {outstanding > 0 && availableSeats.length > 0 && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                const { assigned } = await assignOutstandingTickets({
                                  requestId: r.cr9cd_ticketrequestid,
                                  gameId,
                                  quantity: outstanding,
                                  beneficiaryContactId: r._cr9cd_beneficiary_contact_value ?? null,
                                  availableSeatIds: availableSeats.map((s) => s.cr9cd_seatid),
                                });
                                if (assigned < outstanding) {
                                  setMessage(`Assigned ${assigned} of ${outstanding} requested ticket(s) — not enough seats available.`);
                                }
                              })
                            }
                          >
                            Assign {outstanding} ticket{outstanding === 1 ? '' : 's'}
                          </Button>
                        )}
                        <button className="text-xs font-medium text-slate-500 hover:text-slate-700" onClick={() => setEditingRequestId(r.cr9cd_ticketrequestid)}>
                          Edit
                        </button>
                        <button
                          className="text-xs font-medium text-rose-500 hover:text-rose-700"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              if (
                                !window.confirm(
                                  `Delete this request from ${r.cr9cd_requester_name}? Its assignments will be removed and any held seats freed.`
                                )
                              )
                                return;
                              await deleteRequest(r.cr9cd_ticketrequestid);
                            })
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {requests.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-400">
                    No requests yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mb-4 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Score &amp; Rank</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            loading={busy}
            onClick={() =>
              run(async () => {
                const result = await scoreGame(gameId);
                setRanking(result);
              })
            }
          >
            Score &amp; Rank
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await reconcileOrphanSeats(gameId);
                const result = await recommendForGame(gameId);
                setMessage(`Recommended: ${result.awarded} awarded, ${result.waitlisted} waitlisted.`);
              })
            }
          >
            Recommend assignments
          </Button>
        </div>
        {ranking && (
          <ol className="mt-4 space-y-2">
            {ranking.ranked.map((r) => (
              <li key={r.requestId} className="flex items-center gap-2 text-sm">
                <span className="w-6 shrink-0 text-right tabular-nums text-slate-400">{r.rank}.</span>
                <span className="flex-1 text-slate-700">{r.requesterName}</span>
                <span className="tabular-nums text-slate-500">{r.finalScore.toFixed(3)}</span>
                <Badge tone={r.recommendation === 'award' ? 'green' : 'amber'}>{r.recommendation}</Badge>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="card p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Transfer</h2>
        <p className="mb-3 text-sm text-slate-500">Simulated — no real ticketing-platform integration exists yet.</p>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const count = await transferGame(gameId, 'mock');
              setMessage(`Transferred ${count} approved assignment(s).`);
            })
          }
        >
          Transfer approved
        </Button>
      </div>
    </div>
  );
}

function EditGameForm({ game, onDone }: { game: Cr9cd_games; onDone: () => void }) {
  const [kind, setKind] = useState<GameKind>(game.cr9cd_kind != null ? gameKindChoice.toValue(game.cr9cd_kind) : 'game');
  const [name, setName] = useState((game.cr9cd_kind != null ? gameKindChoice.toValue(game.cr9cd_kind) : 'game') === 'event' ? (game.cr9cd_title ?? '') : (game.cr9cd_opponent ?? ''));
  const [gameDate, setGameDate] = useState(game.cr9cd_game_date ? game.cr9cd_game_date.slice(0, 16) : '');
  const [promotions, setPromotions] = useState(game.cr9cd_promotions ?? '');
  const [notes, setNotes] = useState(game.cr9cd_notes ?? '');
  const [status, setStatus] = useState<GameStatus>(game.cr9cd_status != null ? gameStatusChoice.toValue(game.cr9cd_status) : 'scheduled');
  const [seasonId, setSeasonId] = useState(game._cr9cd_season_value ?? '');
  const [seasons, setSeasons] = useState<Cr9cd_seasons[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Cr9cd_seasonsService.getAll({ orderBy: ['cr9cd_name asc'] }).then((result) => setSeasons(result.data ?? []));
  }, []);

  async function save() {
    setBusy(true);
    try {
      await Cr9cd_gamesService.update(game.cr9cd_gameid, {
        cr9cd_kind: gameKindChoice.toCode(kind),
        cr9cd_opponent: kind === 'game' ? name : '',
        cr9cd_title: kind === 'event' ? name : '',
        cr9cd_game_date: gameDate ? new Date(gameDate).toISOString() : undefined,
        cr9cd_promotions: promotions,
        cr9cd_notes: notes,
        cr9cd_status: gameStatusChoice.toCode(status),
        ...(seasonId && seasonId !== game._cr9cd_season_value ? { 'cr9cd_Season@odata.bind': bindRef('cr9cd_seasons', seasonId) } : {}),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Select value={kind} onChange={(e) => setKind(e.target.value as GameKind)}>
          <option value="game">Game</option>
          <option value="event">Event</option>
        </Select>
        <TextInput placeholder={kind === 'event' ? 'Event title' : 'Opponent'} value={name} onChange={(e) => setName(e.target.value)} />
        <input type="datetime-local" value={gameDate} onChange={(e) => setGameDate(e.target.value)} className="input" />
        <Select value={status} onChange={(e) => setStatus(e.target.value as GameStatus)}>
          <option value="scheduled">Scheduled</option>
          <option value="transfer_pending">Transfer Pending</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </div>
      <TextInput placeholder="Promotions" value={promotions} onChange={(e) => setPromotions(e.target.value)} />
      <TextInput placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <Field label="Season" hint="Move this game/event into a different season">
        <Select value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
          {seasons.map((s) => (
            <option key={s.cr9cd_seasonid} value={s.cr9cd_seasonid}>
              {s.cr9cd_teamname ?? 'Team'} — {s.cr9cd_name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex gap-2">
        <Button disabled={busy} loading={busy} onClick={save}>
          Save
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function EditRequestForm({ request, onDone }: { request: Cr9cd_ticketrequests; onDone: () => void }) {
  const [quantity, setQuantity] = useState(request.cr9cd_quantity ?? 1);
  const [type, setType] = useState<ContactType>(
    request.cr9cd_beneficiary_type != null ? contactTypeChoice.toValue(request.cr9cd_beneficiary_type) : 'customer'
  );
  const [status, setStatus] = useState(request.cr9cd_status != null ? requestStatusChoice.toValue(request.cr9cd_status) : 'submitted');
  const [notes, setNotes] = useState(request.cr9cd_notes ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await Cr9cd_ticketrequestsService.update(request.cr9cd_ticketrequestid, {
        cr9cd_quantity: quantity,
        cr9cd_beneficiary_type: contactTypeChoice.toCode(type),
        cr9cd_status: requestStatusChoice.toCode(status),
        cr9cd_notes: notes,
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="bg-brand-50/40">
      <td className={clsx(tdClass, 'font-medium text-slate-900')}>{request.cr9cd_requester_name}</td>
      <td className={tdClass}>
        <Select value={type} onChange={(e) => setType(e.target.value as ContactType)}>
          <option value="customer">Customer</option>
          <option value="employee">Employee</option>
        </Select>
      </td>
      <td className={tdClass}>
        <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="input w-16" />
      </td>
      <td className={tdClass}>
        <Select value={status} onChange={(e) => setStatus(e.target.value as Parameters<typeof requestStatusChoice.toCode>[0])}>
          <option value="submitted">Submitted</option>
          <option value="scored">Scored</option>
          <option value="recommended">Recommended</option>
          <option value="approved">Approved</option>
          <option value="partially_fulfilled">Partially Fulfilled</option>
          <option value="fulfilled">Fulfilled</option>
          <option value="waitlisted">Waitlisted</option>
          <option value="declined">Declined</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </td>
      <td colSpan={2} className={tdClass}>
        <TextInput placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </td>
      <td colSpan={2} className={clsx(tdClass, 'text-right')}>
        <div className="flex justify-end gap-2">
          <Button size="sm" disabled={busy} loading={busy} onClick={save}>
            Save
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={onDone}>
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

function AddSeatsForm({ gameId, seats, onCreated }: { gameId: string; seats: Cr9cd_seats[]; onCreated: () => void }) {
  const [ticketType, setTicketType] = useState('Standard');
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);

  async function addSeats() {
    setBusy(true);
    try {
      // Continue seat numbering from the current max so numbers stay unique and readable (GA pool).
      const existingNums = seats
        .map((s) => parseInt(String(s.cr9cd_seat_number ?? '').replace(/\D/g, ''), 10))
        .filter((n) => !Number.isNaN(n));
      const start = (existingNums.length ? Math.max(...existingNums) : 0) + 1;
      const type = ticketType.trim() || 'Standard';
      for (let i = 0; i < count; i++) {
        await Cr9cd_seatsService.create({
          'cr9cd_Game@odata.bind': bindRef('cr9cd_games', gameId),
          cr9cd_section: 'GA',
          cr9cd_row: 'GA',
          cr9cd_seat_number: String(start + i),
          cr9cd_ticket_type: type,
          cr9cd_status: seatStatusChoice.toCode('available'),
        } as Parameters<typeof Cr9cd_seatsService.create>[0]);
      }
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Number of seats</label>
        <input type="number" min={1} value={count} onChange={(e) => setCount(Number(e.target.value))} className="input w-24" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Ticket type</label>
        <TextInput value={ticketType} onChange={(e) => setTicketType(e.target.value)} placeholder="Standard" className="w-40" />
      </div>
      <Button size="sm" variant="secondary" disabled={busy} loading={busy} onClick={addSeats}>
        Add seats
      </Button>
    </div>
  );
}

function ReserveModal({
  gameId,
  availableByType,
  onClose,
  onReserved,
}: {
  gameId: string;
  availableByType: Array<[string, number]>;
  onClose: () => void;
  onReserved: () => void;
}) {
  const [personName, setPersonName] = useState('');
  const [personEmail, setPersonEmail] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [ticketType, setTicketType] = useState('');
  const [expiresDate, setExpiresDate] = useState(() => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!personName.trim()) return;
    setBusy(true);
    setError('');
    try {
      // Deadline is the end of the chosen day.
      const expiresAt = new Date(`${expiresDate}T23:59:59`).toISOString();
      await createReservations({
        gameId,
        personName: personName.trim(),
        personEmail: personEmail.trim() || undefined,
        quantity,
        ticketType: ticketType || undefined,
        expiresAt,
      });
      onReserved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Reserve seats"
      description="Offer available seats to a named person with a deadline. Unclaimed holds auto-expire back to the pool."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!personName.trim()} onClick={submit}>
            Reserve
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Person" required>
          <TextInput value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Full name" />
        </Field>
        <Field label="Email">
          <TextInput value={personEmail} onChange={(e) => setPersonEmail(e.target.value)} placeholder="Optional" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Number of seats">
            <TextInput type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </Field>
          {availableByType.length > 1 && (
            <Field label="Ticket type">
              <Select value={ticketType} onChange={(e) => setTicketType(e.target.value)}>
                <option value="">Any type</option>
                {availableByType.map(([t, n]) => (
                  <option key={t} value={t}>
                    {t} ({n})
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Reserve by">
          <TextInput type="date" value={expiresDate} onChange={(e) => setExpiresDate(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

function NewRequestForm({ gameId, onCreated }: { gameId: string; onCreated: () => void }) {
  const [contact, setContact] = useState<ContactSelection | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [type, setType] = useState<ContactType>('customer');
  const [salesOpp, setSalesOpp] = useState(0);
  const [opportunity, setOpportunity] = useState<{ id: string; name: string } | null>(null);
  const [accountOwner, setAccountOwner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCrmPicker, setShowCrmPicker] = useState(false);

  function selectContact(selection: ContactSelection) {
    setContact(selection);
    setType(selection.type);
    setShowCrmPicker(false);
  }

  function resetForm() {
    setContact(null);
    setOpportunity(null);
    setAccountOwner(null);
    setQuantity(1);
    setSalesOpp(0);
  }

  async function createRequest() {
    if (!contact) return;
    setBusy(true);
    try {
      await Cr9cd_ticketrequestsService.create({
        'cr9cd_Game@odata.bind': bindRef('cr9cd_games', gameId),
        'cr9cd_Beneficiary_Contact@odata.bind': bindRef('cr9cd_contact_beneficiaries', contact.id),
        cr9cd_requester_name: contact.name,
        cr9cd_beneficiary_type: contactTypeChoice.toCode(type),
        cr9cd_quantity: quantity,
        cr9cd_sales_opportunity_usd: salesOpp,
        cr9cd_status: requestStatusChoice.toCode('submitted'),
        ...(accountOwner ? { cr9cd_account_owner: accountOwner } : {}),
        ...(opportunity ? { cr9cd_crm_opportunity_id: opportunity.id, cr9cd_crm_opportunity_name: opportunity.name } : {}),
      } as Parameters<typeof Cr9cd_ticketrequestsService.create>[0]);
      resetForm();
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  if (!contact) {
    return (
      <div className="mb-4">
        {!showCrmPicker && (
          <>
            <ContactPicker onSelect={selectContact} />
            <button className="mb-2 text-xs font-medium text-brand-600 hover:text-brand-700" onClick={() => setShowCrmPicker(true)}>
              Import from CRM instead…
            </button>
          </>
        )}
        {showCrmPicker && (
          <>
            <CrmPicker
              onSelect={async ({ account, contact: crmContact, opportunity: crmOpportunity }) => {
                setBusy(true);
                try {
                  const id = await upsertBeneficiaryFromCrmContact({
                    crmContactId: crmContact.id,
                    crmAccountId: account.id,
                    fullName: crmContact.fullName,
                    email: crmContact.email,
                    phone: crmContact.phone,
                    title: crmContact.title,
                    company: account.name,
                  });
                  if (crmOpportunity) {
                    setOpportunity({ id: crmOpportunity.id, name: crmOpportunity.name });
                    setSalesOpp(crmOpportunity.manualRepCredit ?? crmOpportunity.estimatedValue ?? 0);
                  }
                  setAccountOwner(account.ownerName);
                  selectContact({ id, name: crmContact.fullName, type: 'customer' });
                } finally {
                  setBusy(false);
                }
              }}
            />
            <button className="mb-2 text-xs font-medium text-slate-500 hover:text-slate-700" onClick={() => setShowCrmPicker(false)}>
              Cancel
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mb-4">
      <p className="mb-2 text-sm text-slate-500">
        Requestor: <span className="font-medium text-slate-700">{contact.name}</span>{' '}
        <button className="text-xs font-medium text-slate-500 hover:text-slate-700" onClick={resetForm}>
          Change
        </button>
      </p>
      {opportunity && (
        <p className="mb-2 text-sm text-slate-500">
          Opportunity: <span className="font-medium text-slate-700">{opportunity.name}</span>{' '}
          <button className="text-xs font-medium text-slate-500 hover:text-slate-700" onClick={() => setOpportunity(null)}>
            Unlink
          </button>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value as ContactType)} className="w-auto">
          <option value="customer">Customer</option>
          <option value="employee">Employee</option>
        </Select>
        <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="input w-16" title="Quantity" />
        <input
          type="number"
          min={0}
          placeholder="Sales opp $"
          value={salesOpp}
          onChange={(e) => setSalesOpp(Number(e.target.value))}
          className="input w-28"
          title={opportunity ? 'Prefilled from the linked opportunity\'s Manual Rep Credit — editable' : 'Sales opportunity $'}
        />
        <Button disabled={busy} loading={busy} onClick={createRequest}>
          New request
        </Button>
      </div>
    </div>
  );
}

function AttendanceForm({ assignmentId, onDone }: { assignmentId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [businessGenerated, setBusinessGenerated] = useState(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button className="text-xs font-medium text-brand-600 hover:text-brand-700" onClick={() => setOpen(true)} disabled={busy}>
        Reconcile
      </button>
    );
  }

  async function submit(status: AttendanceOutcome) {
    setBusy(true);
    try {
      await recordAttendance({
        assignmentId,
        ticketStatus: status,
        businessGenerated,
        followUpNotes: notes.trim() || undefined,
      });
      setOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <input
        type="number"
        min={0}
        value={businessGenerated}
        onChange={(e) => setBusinessGenerated(Number(e.target.value))}
        placeholder="$ generated"
        className="input w-24"
      />
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes"
        className="input w-32"
      />
      <button className="text-xs font-medium text-emerald-600 hover:text-emerald-700" disabled={busy} onClick={() => submit('attended')}>
        Attended
      </button>
      <button className="text-xs font-medium text-rose-500 hover:text-rose-700" disabled={busy} onClick={() => submit('no_show')}>
        No-show
      </button>
      <button className="text-xs font-medium text-zinc-500 hover:text-zinc-700" disabled={busy} onClick={() => submit('cancelled')}>
        Cancelled
      </button>
    </span>
  );
}
