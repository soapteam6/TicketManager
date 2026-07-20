import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cr9cd_ticketrequestsService } from '../generated/services/Cr9cd_ticketrequestsService';
import { Cr9cd_requestcontactsService } from '../generated/services/Cr9cd_requestcontactsService';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_seasonsService } from '../generated/services/Cr9cd_seasonsService';
import { Cr9cd_teamsService } from '../generated/services/Cr9cd_teamsService';
import type { Cr9cd_ticketrequests } from '../generated/models/Cr9cd_ticketrequestsModel';
import type { Cr9cd_games } from '../generated/models/Cr9cd_gamesModel';
import type { Cr9cd_teams } from '../generated/models/Cr9cd_teamsModel';
import { bindRef } from '../dataverse/bind';
import { requestStatusChoice, contactTypeChoice, gameStatusChoice, gameKindChoice } from '../dataverse/choiceMaps';
import { formatUsd, formatDate } from '../lib/format';
import { REQUEST_STATUS, type RequestStatus, type ContactType } from '../domain/enums';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Field, Select, TextInput, TextArea, EnumOptions } from '../components/Field';
import { Modal } from '../components/Modal';
import ContactPicker, { type ContactSelection } from '../components/ContactPicker';
import CrmPicker from '../components/CrmPicker';
import { upsertBeneficiaryFromCrmContact } from '../services/crmService';
import { deleteRequest } from '../services/requestsService';
import { moveRequestToWaitlist } from '../services/waitlistService';
import { useAuth } from '../auth/AuthContext';

export default function RequestsPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<RequestStatus | ''>('');
  const [requests, setRequests] = useState<Cr9cd_ticketrequests[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [gameById, setGameById] = useState<Record<string, Cr9cd_games>>({});
  const [beneficiaryCountByRequestId, setBeneficiaryCountByRequestId] = useState<Record<string, number>>({});

  function load() {
    setLoading(true);
    Cr9cd_ticketrequestsService
      .getAll({ filter: status ? `cr9cd_status eq ${requestStatusChoice.toCode(status)}` : undefined })
      .then((result) => {
        setRequests(result.data ?? []);
        setLoading(false);
      });
  }

  useEffect(load, [status]);

  // Load games once (not tied to the status filter) so the list can join game date / opponent / event.
  useEffect(() => {
    Cr9cd_gamesService.getAll({ select: ['cr9cd_gameid', 'cr9cd_opponent', 'cr9cd_title', 'cr9cd_kind', 'cr9cd_game_date'] }).then((result) => {
      const map: Record<string, Cr9cd_games> = {};
      for (const g of result.data ?? []) map[g.cr9cd_gameid] = g;
      setGameById(map);
    });
  }, []);

  // Load all request↔contact join rows once and tally how many beneficiaries each request has.
  useEffect(() => {
    Cr9cd_requestcontactsService.getAll({ select: ['cr9cd_requestcontactid', '_cr9cd_ticket_request_value'] }).then((result) => {
      const counts: Record<string, number> = {};
      for (const rc of result.data ?? []) {
        const reqId = rc._cr9cd_ticket_request_value;
        if (reqId) counts[reqId] = (counts[reqId] ?? 0) + 1;
      }
      setBeneficiaryCountByRequestId(counts);
    });
  }, []);

  const gameFor = (r: Cr9cd_ticketrequests) => (r._cr9cd_game_value ? gameById[r._cr9cd_game_value] : undefined);

  const columns: Column<Cr9cd_ticketrequests>[] = [
    {
      key: 'requester',
      header: 'Requester',
      render: (r) => {
        const name = r.cr9cd_requester_name || '—';
        const joinCount = beneficiaryCountByRequestId[r.cr9cd_ticketrequestid];
        const n = joinCount ? joinCount - 1 : (r.cr9cd_quantity ?? 1) - 1;
        return (
          <div>
            <div className="font-medium text-slate-900">
              {name}
              {n > 0 && <span className="text-slate-400"> +{n}</span>}
            </div>
            <div className="text-xs text-slate-400">{r.cr9cd_requester_company ?? ''}</div>
          </div>
        );
      },
    },
    {
      key: 'game',
      header: 'Game',
      render: (r) => {
        const game = gameFor(r);
        return (
          <Link to={`/games/${r._cr9cd_game_value}`} className="text-brand-700 hover:underline">
            {game ? formatDate(game.cr9cd_game_date) : r.cr9cd_gamename ?? 'Game'}
          </Link>
        );
      },
    },
    {
      key: 'opponent',
      header: 'Opponent',
      render: (r) => {
        const g = gameFor(r);
        const kind = g?.cr9cd_kind != null ? gameKindChoice.toValue(g.cr9cd_kind) : 'game';
        return kind === 'game' && g?.cr9cd_opponent ? g.cr9cd_opponent : <span className="text-slate-400">—</span>;
      },
    },
    {
      key: 'event',
      header: 'Event',
      render: (r) => {
        const g = gameFor(r);
        const kind = g?.cr9cd_kind != null ? gameKindChoice.toValue(g.cr9cd_kind) : 'game';
        return kind === 'event' && g?.cr9cd_title ? g.cr9cd_title : <span className="text-slate-400">—</span>;
      },
    },
    {
      key: 'owner',
      header: 'Account owner',
      render: (r) => r.cr9cd_account_owner || <span className="text-slate-400">—</span>,
    },
    {
      key: 'type',
      header: 'For',
      render: (r) => <Badge tone="slate">{r.cr9cd_beneficiary_type != null ? contactTypeChoice.toValue(r.cr9cd_beneficiary_type) : '—'}</Badge>,
    },
    { key: 'qty', header: 'Qty', align: 'right', render: (r) => r.cr9cd_quantity ?? 1 },
    { key: 'sales', header: 'Sales opp', align: 'right', render: (r) => formatUsd(r.cr9cd_sales_opportunity_usd) },
    {
      key: 'score',
      header: 'Score',
      align: 'right',
      render: (r) => (r.cr9cd_priority_score != null ? r.cr9cd_priority_score.toFixed(3) : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge status={r.cr9cd_status != null ? requestStatusChoice.toValue(r.cr9cd_status) : 'submitted'} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      render: (r: Cr9cd_ticketrequests) => {
        const id = r.cr9cd_ticketrequestid;
        if (confirmDeleteId === id) {
          return (
            <div className="flex items-center justify-end gap-1.5">
              <Button
                size="sm"
                variant="danger"
                disabled={busyId === id}
                loading={busyId === id}
                onClick={async () => {
                  setBusyId(id);
                  try {
                    await deleteRequest(id);
                    setConfirmDeleteId(null);
                    load();
                  } finally {
                    setBusyId(null);
                  }
                }}
              >
                Delete
              </Button>
              <Button size="sm" variant="secondary" disabled={busyId === id} onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </Button>
            </div>
          );
        }
        const status = r.cr9cd_status != null ? requestStatusChoice.toValue(r.cr9cd_status) : 'submitted';
        return (
          <div className="flex items-center justify-end gap-1.5">
            {status !== 'waitlisted' && r._cr9cd_game_value && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busyId === id}
                loading={busyId === id}
                onClick={async () => {
                  setBusyId(id);
                  try {
                    await moveRequestToWaitlist(r._cr9cd_game_value!, id, 'Moved to waitlist');
                    load();
                  } finally {
                    setBusyId(null);
                  }
                }}
              >
                Waitlist
              </Button>
            )}
            {user?.isAdmin && (
              <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(id)}>
                Delete
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Requests"
        subtitle="Ticket requests across every game."
        actions={
          <>
            <Field className="w-44">
              <Select value={status} onChange={(e) => setStatus(e.target.value as RequestStatus | '')}>
                <EnumOptions values={REQUEST_STATUS} includeBlank blankLabel="All statuses" />
              </Select>
            </Field>
            {/* TODO(jay): wire import-from-email — placeholder until the email intake flow is available here. */}
            <Button variant="secondary" onClick={() => window.alert('Import from email is coming soon.')}>
              Import from email
            </Button>
            <Button onClick={() => setShowNew(true)}>New request</Button>
          </>
        }
      />

      <DataTable columns={columns} rows={requests} loading={loading} keyFn={(r) => r.cr9cd_ticketrequestid} emptyTitle="No requests" />

      {showNew && (
        <NewRequestModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            load();
          }}
        />
      )}
    </div>
  );
}

// Cross-game request creation — pick a game/event first, then the same contact-selection flow
// used on GameDetailPage's per-game request form.
function NewRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [games, setGames] = useState<Cr9cd_games[]>([]);
  const [teams, setTeams] = useState<Cr9cd_teams[]>([]);
  const [seasonToTeamId, setSeasonToTeamId] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'game' | 'event'>('game');
  const [teamId, setTeamId] = useState('');
  const [gameId, setGameId] = useState('');
  const [contact, setContact] = useState<ContactSelection | null>(null);
  const [extraContacts, setExtraContacts] = useState<ContactSelection[]>([]);
  const [addingBeneficiary, setAddingBeneficiary] = useState(false);
  const [type, setType] = useState<ContactType>('customer');
  const [quantity, setQuantity] = useState(1);
  const [salesOpp, setSalesOpp] = useState(0);
  const [notes, setNotes] = useState('');
  const [opportunity, setOpportunity] = useState<{ id: string; name: string } | null>(null);
  const [accountOwner, setAccountOwner] = useState<string | null>(null);
  const [showCrmPicker, setShowCrmPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      Cr9cd_gamesService.getAll({
        filter: `cr9cd_status eq ${gameStatusChoice.toCode('scheduled')}`,
        orderBy: ['cr9cd_game_date asc'],
      }),
      Cr9cd_seasonsService.getAll({ select: ['cr9cd_seasonid', 'cr9cd_teamname', '_cr9cd_team_value'] }),
      Cr9cd_teamsService.getAll({ select: ['cr9cd_teamid', 'cr9cd_name'], orderBy: ['cr9cd_name asc'] }),
    ]).then(([gamesResult, seasonsResult, teamsResult]) => {
      setGames(gamesResult.data ?? []);
      setTeams(teamsResult.data ?? []);
      const map: Record<string, string> = {};
      for (const s of seasonsResult.data ?? []) map[s.cr9cd_seasonid] = s._cr9cd_team_value ?? '';
      setSeasonToTeamId(map);
    });
  }, []);

  function selectContact(selection: ContactSelection) {
    setContact(selection);
    setType(selection.type);
    setShowCrmPicker(false);
  }

  async function create() {
    if (!gameId || !contact) return;
    setBusy(true);
    setError('');
    try {
      const beneficiaries = [contact, ...extraContacts];
      const result = await Cr9cd_ticketrequestsService.create({
        'cr9cd_Game@odata.bind': bindRef('cr9cd_games', gameId),
        'cr9cd_Beneficiary_Contact@odata.bind': bindRef('cr9cd_contact_beneficiaries', contact.id),
        cr9cd_requester_name: contact.name,
        cr9cd_beneficiary_type: contactTypeChoice.toCode(type),
        cr9cd_quantity: Math.max(quantity, beneficiaries.length),
        cr9cd_sales_opportunity_usd: salesOpp,
        cr9cd_notes: notes || undefined,
        cr9cd_status: requestStatusChoice.toCode('submitted'),
        ...(accountOwner ? { cr9cd_account_owner: accountOwner } : {}),
        ...(opportunity ? { cr9cd_crm_opportunity_id: opportunity.id, cr9cd_crm_opportunity_name: opportunity.name } : {}),
      } as Parameters<typeof Cr9cd_ticketrequestsService.create>[0]);
      // Write a request↔contact join row for the primary contact plus every extra beneficiary.
      // Best-effort: a join-row failure must not block the request from being created.
      const newId = result.data?.cr9cd_ticketrequestid;
      if (newId) {
        for (const b of beneficiaries) {
          try {
            await Cr9cd_requestcontactsService.create({
              'cr9cd_Ticket_Request@odata.bind': bindRef('cr9cd_ticketrequests', newId),
              'cr9cd_Contact@odata.bind': bindRef('cr9cd_contact_beneficiaries', b.id),
              cr9cd_name: b.name,
            } as Parameters<typeof Cr9cd_requestcontactsService.create>[0]);
          } catch {
            // ignore individual join-row failures
          }
        }
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const gameTeamId = (g: Cr9cd_games) => seasonToTeamId[g._cr9cd_season_value ?? ''] ?? '';
  const gameKind = (g: Cr9cd_games) => (g.cr9cd_kind != null ? gameKindChoice.toValue(g.cr9cd_kind) : 'game');

  // Teams that have at least one team-game (kind 'game') to request against.
  const teamsWithGames = teams.filter((t) => games.some((g) => gameKind(g) === 'game' && gameTeamId(g) === t.cr9cd_teamid));
  // Opponent games for the chosen team.
  const teamGames = games.filter((g) => gameKind(g) === 'game' && gameTeamId(g) === teamId);
  // All standalone events.
  const eventGames = games.filter((g) => gameKind(g) === 'event');
  const selectedGame = games.find((g) => g.cr9cd_gameid === gameId);

  return (
    <Modal
      open
      onClose={onClose}
      title="New request"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!gameId || !contact} onClick={create}>
            Create request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-2 flex gap-1 text-sm">
            <button
              type="button"
              onClick={() => {
                setMode('game');
                setGameId('');
                setTeamId('');
              }}
              className={`rounded-md px-3 py-1.5 font-medium ${mode === 'game' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              Team game
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('event');
                setGameId('');
                setTeamId('');
              }}
              className={`rounded-md px-3 py-1.5 font-medium ${mode === 'event' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              Event
            </button>
          </div>

          {mode === 'game' ? (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Team" required>
                <Select
                  value={teamId}
                  onChange={(e) => {
                    setTeamId(e.target.value);
                    setGameId('');
                  }}
                  required
                >
                  <option value="">Select team…</option>
                  {teamsWithGames.map((t) => (
                    <option key={t.cr9cd_teamid} value={t.cr9cd_teamid}>
                      {t.cr9cd_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Opponent (vs)" required>
                <Select value={gameId} onChange={(e) => setGameId(e.target.value)} disabled={!teamId} required>
                  <option value="">Select opponent…</option>
                  {teamGames.map((g) => (
                    <option key={g.cr9cd_gameid} value={g.cr9cd_gameid}>
                      {`vs ${g.cr9cd_opponent} — ${formatDate(g.cr9cd_game_date)}`}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Start time" hint="Auto-filled">
                <TextInput value={selectedGame ? formatDate(selectedGame.cr9cd_game_date) : '—'} disabled readOnly />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Event" required>
                <Select value={gameId} onChange={(e) => setGameId(e.target.value)} required>
                  <option value="">Select event…</option>
                  {eventGames.map((g) => (
                    <option key={g.cr9cd_gameid} value={g.cr9cd_gameid}>
                      {`${g.cr9cd_title} — ${formatDate(g.cr9cd_game_date)}`}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Start time" hint="Auto-filled">
                <TextInput value={selectedGame ? formatDate(selectedGame.cr9cd_game_date) : '—'} disabled readOnly />
              </Field>
            </div>
          )}
        </div>

        {!contact ? (
          <div>
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
        ) : (
          <div>
            <p className="mb-2 text-sm text-slate-500">
              Requestor: <span className="font-medium text-slate-700">{contact.name}</span>{' '}
              <button
                className="text-xs font-medium text-slate-500 hover:text-slate-700"
                onClick={() => {
                  setContact(null);
                  setExtraContacts([]);
                  setAddingBeneficiary(false);
                  setOpportunity(null);
                  setAccountOwner(null);
                }}
              >
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
            <Field label="Beneficiaries" className="mb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="font-medium">{contact.name}</span>
                  <span className="text-xs text-slate-400">primary</span>
                </div>
                {extraContacts.map((b, i) => (
                  <div key={b.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="font-medium">{b.name}</span>
                    <button
                      className="text-xs font-medium text-slate-500 hover:text-slate-700"
                      onClick={() => setExtraContacts((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              {addingBeneficiary ? (
                <div className="mt-2">
                  <ContactPicker
                    onSelect={(selection) => {
                      setExtraContacts((prev) =>
                        selection.id === contact.id || prev.some((b) => b.id === selection.id) ? prev : [...prev, selection],
                      );
                      setAddingBeneficiary(false);
                    }}
                  />
                  <button className="text-xs font-medium text-slate-500 hover:text-slate-700" onClick={() => setAddingBeneficiary(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="mt-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                  onClick={() => setAddingBeneficiary(true)}
                >
                  Add beneficiary
                </button>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Beneficiary type" hint="Customer → CRM · Employee → name" required>
                <Select value={type} onChange={(e) => setType(e.target.value as ContactType)}>
                  <option value="customer">Customer</option>
                  <option value="employee">Employee</option>
                </Select>
              </Field>
              <Field label="Quantity" hint="Defaults to number of beneficiaries">
                <TextInput type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
              </Field>
              <Field label="Revenue — manual rep credit (USD)" hint="From the selected opportunity">
                <TextInput type="number" min={0} value={salesOpp} onChange={(e) => setSalesOpp(Number(e.target.value))} />
              </Field>
            </div>
            <Field label="Notes" className="mt-4">
              <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}
