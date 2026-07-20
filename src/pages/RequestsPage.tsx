import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cr9cd_ticketrequestsService } from '../generated/services/Cr9cd_ticketrequestsService';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_seasonsService } from '../generated/services/Cr9cd_seasonsService';
import type { Cr9cd_ticketrequests } from '../generated/models/Cr9cd_ticketrequestsModel';
import type { Cr9cd_games } from '../generated/models/Cr9cd_gamesModel';
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

  const columns: Column<Cr9cd_ticketrequests>[] = [
    {
      key: 'requester',
      header: 'Requester',
      render: (r) => (
        <div>
          <div className="font-medium text-slate-900">{r.cr9cd_requester_name || '—'}</div>
          <div className="text-xs text-slate-400">{r.cr9cd_requester_company ?? ''}</div>
        </div>
      ),
    },
    {
      key: 'game',
      header: 'Game',
      render: (r) => (
        <Link to={`/games/${r._cr9cd_game_value}`} className="text-brand-700 hover:underline">
          {r.cr9cd_gamename ?? 'Game'}
        </Link>
      ),
    },
    {
      key: 'type',
      header: 'For',
      render: (r) => <Badge tone="slate">{r.cr9cd_beneficiary_type != null ? contactTypeChoice.toValue(r.cr9cd_beneficiary_type) : '—'}</Badge>,
    },
    { key: 'qty', header: 'Qty', align: 'right', render: (r) => r.cr9cd_quantity ?? 1 },
    { key: 'sales', header: 'Sales opp', align: 'right', render: (r) => formatUsd(r.cr9cd_sales_opportunity_usd) },
    {
      key: 'owner',
      header: 'Account owner',
      render: (r) => r.cr9cd_account_owner || <span className="text-slate-400">—</span>,
    },
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
  const [teamBySeasonId, setTeamBySeasonId] = useState<Record<string, string>>({});
  const [gameId, setGameId] = useState('');
  const [contact, setContact] = useState<ContactSelection | null>(null);
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
      Cr9cd_seasonsService.getAll({ select: ['cr9cd_seasonid', 'cr9cd_teamname'] }),
    ]).then(([gamesResult, seasonsResult]) => {
      setGames(gamesResult.data ?? []);
      const map: Record<string, string> = {};
      for (const s of seasonsResult.data ?? []) map[s.cr9cd_seasonid] = s.cr9cd_teamname ?? '';
      setTeamBySeasonId(map);
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
      await Cr9cd_ticketrequestsService.create({
        'cr9cd_Game@odata.bind': bindRef('cr9cd_games', gameId),
        'cr9cd_Beneficiary_Contact@odata.bind': bindRef('cr9cd_contact_beneficiaries', contact.id),
        cr9cd_requester_name: contact.name,
        cr9cd_beneficiary_type: contactTypeChoice.toCode(type),
        cr9cd_quantity: quantity,
        cr9cd_sales_opportunity_usd: salesOpp,
        cr9cd_notes: notes || undefined,
        cr9cd_status: requestStatusChoice.toCode('submitted'),
        ...(accountOwner ? { cr9cd_account_owner: accountOwner } : {}),
        ...(opportunity ? { cr9cd_crm_opportunity_id: opportunity.id, cr9cd_crm_opportunity_name: opportunity.name } : {}),
      } as Parameters<typeof Cr9cd_ticketrequestsService.create>[0]);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function gameLabel(g: Cr9cd_games): string {
    const kind = g.cr9cd_kind != null ? gameKindChoice.toValue(g.cr9cd_kind) : 'game';
    const what = kind === 'event' ? g.cr9cd_title : `vs ${g.cr9cd_opponent}`;
    const team = g._cr9cd_season_value ? teamBySeasonId[g._cr9cd_season_value] : '';
    return `${formatDate(g.cr9cd_game_date)} — ${team ? `${team} ` : ''}${what}`;
  }

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
        <Field label="Game / event" required>
          <Select value={gameId} onChange={(e) => setGameId(e.target.value)} required>
            <option value="">Select a game or event…</option>
            {games.map((g) => (
              <option key={g.cr9cd_gameid} value={g.cr9cd_gameid}>
                {gameLabel(g)}
              </option>
            ))}
          </Select>
        </Field>

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
            <div className="grid grid-cols-2 gap-4">
              <Field label="Type">
                <Select value={type} onChange={(e) => setType(e.target.value as ContactType)}>
                  <option value="customer">Customer</option>
                  <option value="employee">Employee</option>
                </Select>
              </Field>
              <Field label="Quantity">
                <TextInput type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
              </Field>
              <Field label="Sales opp $" hint={opportunity ? "Prefilled from the linked opportunity's Manual Rep Credit" : undefined}>
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
