import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { REQUEST_STATUS, CONTACT_TYPE } from '@ais/shared';
import { api } from '@/lib/api';
import type { Game, TicketRequest } from '@/lib/types';
import { pickArray } from '@/lib/unwrap';
import { formatUsd, formatDate, formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState, ErrorNote } from '@/components/QueryState';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Field, TextInput, TextArea, Select, EnumOptions } from '@/components/Field';
import { CrmPicker, type CrmSelection } from '@/components/CrmPicker';
import { RoleGate } from '@/auth/AuthContext';

export function RequestsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const requests = useQuery({
    queryKey: ['requests', { status }],
    queryFn: async () => {
      const res = await api.get('/requests', { params: status ? { status } : undefined });
      return pickArray<TicketRequest>(res.data, 'requests');
    },
  });

  const del = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/requests/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: ['game'] });
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      setConfirmDeleteId(null);
    },
  });

  const waitlist = useMutation({
    mutationFn: async (r: TicketRequest) => (await api.post('/waitlist', { gameId: r.gameId, requestId: r.id })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: ['game'] });
      qc.invalidateQueries({ queryKey: ['waitlist'] });
    },
  });

  const columns: Column<TicketRequest>[] = [
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
    {
      key: 'game',
      header: 'Game',
      render: (r) => (
        <Link to={`/games/${r.gameId}`} className="text-brand-700 hover:underline">
          {r.gameDate ? formatDate(r.gameDate) : `Game #${r.gameId}`}
        </Link>
      ),
    },
    { key: 'opponent', header: 'Opponent', render: (r) => (r.gameKind === 'event' ? <span className="text-slate-400">—</span> : r.opponent ?? <span className="text-slate-400">—</span>) },
    { key: 'event', header: 'Event', render: (r) => (r.gameKind === 'event' ? (r.gameTitle ?? r.opponent ?? '—') : <span className="text-slate-400">—</span>) },
    { key: 'owner', header: 'Account owner', render: (r) => r.accountOwner ?? <span className="text-slate-400">—</span> },
    { key: 'type', header: 'For', render: (r) => <Badge tone="slate">{r.beneficiaryType}</Badge> },
    { key: 'qty', header: 'Qty', align: 'right', render: (r) => r.quantity },
    { key: 'sales', header: 'Sales opp', align: 'right', render: (r) => formatUsd(r.salesOpportunityUsd) },
    { key: 'score', header: 'Score', align: 'right', render: (r) => (r.priorityScore != null ? r.priorityScore.toFixed(3) : '—') },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => {
        const canWaitlist = !['waitlisted', 'cancelled', 'declined'].includes(r.status);
        return (
          <RoleGate roles={['admin']}>
            {confirmDeleteId === r.id ? (
              <div className="flex items-center justify-end gap-2">
                <span className="text-xs text-rose-700">Delete?</span>
                <Button size="sm" variant="danger" loading={del.isPending} onClick={() => del.mutate(r.id)}>Confirm</Button>
                <Button size="sm" variant="secondary" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-2">
                {canWaitlist && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={waitlist.isPending && waitlist.variables?.id === r.id}
                    onClick={() => waitlist.mutate(r)}
                  >
                    Waitlist
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => setConfirmDeleteId(r.id)}>Delete</Button>
              </div>
            )}
          </RoleGate>
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
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <EnumOptions values={REQUEST_STATUS} includeBlank blankLabel="All statuses" />
              </Select>
            </Field>
            <Button variant="secondary" onClick={() => setShowImport(true)}>Import from email</Button>
            <Button onClick={() => setShowNew(true)}>New request</Button>
          </>
        }
      />

      <ErrorNote error={del.error || waitlist.error} />

      <QueryState isLoading={requests.isLoading} error={requests.error}>
        <DataTable columns={columns} rows={requests.data} keyFn={(r) => r.id} emptyTitle="No requests" />
      </QueryState>

      {showNew && <NewRequestModal onClose={() => setShowNew(false)} />}
      {showImport && <ImportRequestsModal onClose={() => setShowImport(false)} />}
    </div>
  );
}

function useGamesForSelect() {
  return useQuery({
    queryKey: ['games', 'select'],
    queryFn: async () => pickArray<Game>((await api.get('/games')).data, 'games'),
    staleTime: 60_000,
  });
}

function NewRequestModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const games = useGamesForSelect();

  const [entryType, setEntryType] = useState<'game' | 'event'>('game');
  const [teamId, setTeamId] = useState('');
  const [gameId, setGameId] = useState('');
  const [beneficiaryType, setBeneficiaryType] = useState('customer');
  const [quantity, setQuantity] = useState('');
  const [quantityTouched, setQuantityTouched] = useState(false);
  const [salesOpportunityUsd, setSalesOpportunityUsd] = useState('');
  const [notes, setNotes] = useState('');
  const [sel, setSel] = useState<CrmSelection | null>(null);
  const [empName, setEmpName] = useState('');

  const isEmployee = beneficiaryType === 'employee';

  function handleTypeChange(next: string) {
    setBeneficiaryType(next);
    // Switching source clears the other selection and derived fields.
    setSel(null);
    setEmpName('');
    setSalesOpportunityUsd('');
    if (!quantityTouched) setQuantity('');
  }

  function handleCrmChange(next: CrmSelection | null) {
    setSel(next);
    if (next && !quantityTouched) setQuantity(String(next.contacts.length || ''));
    if (next?.opportunity) setSalesOpportunityUsd(next.opportunity.revenue != null ? String(next.opportunity.revenue) : '');
  }

  // Selection: Team game (Team -> Opponent) or Event (by title). Both resolve to a gameId.
  const scheduledGames = (games.data ?? []).filter((g) => g.status === 'scheduled');
  const teamGamesAll = scheduledGames.filter((g) => g.kind !== 'event');
  const eventsAll = scheduledGames.filter((g) => g.kind === 'event');
  const teamOptions = Array.from(
    new Map(teamGamesAll.filter((g) => g.teamId != null).map((g) => [g.teamId as number, g.teamName ?? `Team ${g.teamId}`])).entries()
  );
  const teamGames = teamGamesAll.filter((g) => String(g.teamId) === teamId);
  const selectedGame = scheduledGames.find((g) => String(g.id) === gameId) ?? null;

  function changeEntryType(next: 'game' | 'event') {
    setEntryType(next);
    setTeamId('');
    setGameId('');
  }

  const beneficiariesCount = isEmployee ? (empName.trim() ? 1 : 0) : sel?.contacts.length ?? 0;
  const canCreate = !!gameId && beneficiariesCount > 0 && Number(quantity) >= 1;

  const create = useMutation({
    mutationFn: async () => {
      const beneficiaryContacts = isEmployee
        ? [{ fullName: empName.trim() }]
        : sel?.contacts.map((c) => ({
            crmContactId: c.crmContactId ?? undefined,
            crmAccountId: c.crmAccountId ?? undefined,
            fullName: c.fullName,
            company: c.company ?? undefined,
            email: c.email ?? undefined,
            phone: c.phone ?? undefined,
            title: c.title ?? undefined,
          }));

      return (
        await api.post('/requests', {
          gameId: Number(gameId),
          beneficiaryType,
          quantity: Number(quantity || beneficiariesCount || 1),
          // Revenue/opportunity only apply to customer (CRM) requests.
          salesOpportunityUsd: !isEmployee && salesOpportunityUsd ? Number(salesOpportunityUsd) : undefined,
          requesterCompany: isEmployee ? undefined : sel?.account.name,
          crmAccountId: isEmployee ? undefined : sel?.account.crmAccountId,
          beneficiaryContacts,
          crmOpportunityId: isEmployee ? undefined : sel?.opportunity?.crmOpportunityId,
          crmOpportunityName: isEmployee ? undefined : sel?.opportunity?.name,
          accountOwner: isEmployee ? undefined : sel?.account.ownerName ?? undefined,
          notes: notes || undefined,
        })
      ).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
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
      title="New request"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="new-request" loading={create.isPending} disabled={!canCreate}>Create request</Button>
        </>
      }
    >
      <form id="new-request" onSubmit={onSubmit} className="space-y-4">
        <div className="flex gap-1 text-sm">
          <button
            type="button"
            onClick={() => changeEntryType('game')}
            className={`rounded-md px-3 py-1.5 font-medium ${entryType === 'game' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            Team game
          </button>
          <button
            type="button"
            onClick={() => changeEntryType('event')}
            className={`rounded-md px-3 py-1.5 font-medium ${entryType === 'event' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            Event
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {entryType === 'game' ? (
            <Field label="Team" required>
              <Select
                value={teamId}
                onChange={(e) => {
                  setTeamId(e.target.value);
                  setGameId('');
                }}
                required
              >
                <option value="">Select a team…</option>
                {teamOptions.map(([tid, tname]) => (
                  <option key={tid} value={String(tid)}>
                    {tname}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Event" required>
              <Select value={gameId} onChange={(e) => setGameId(e.target.value)} required>
                <option value="">Select an event…</option>
                {eventsAll.map((ev) => (
                  <option key={ev.id} value={String(ev.id)}>
                    {ev.title ?? ev.opponent}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Beneficiary type" required hint="Customer → CRM · Employee → name">
            <Select value={beneficiaryType} onChange={(e) => handleTypeChange(e.target.value)}>
              <EnumOptions values={CONTACT_TYPE} />
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {entryType === 'game' ? (
            <Field label="Opponent (vs)" required>
              <Select value={gameId} onChange={(e) => setGameId(e.target.value)} required disabled={!teamId}>
                <option value="">{teamId ? 'Select opponent…' : 'Select a team first'}</option>
                {teamGames.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    vs {g.opponent} — {formatDate(g.gameDate)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <div />
          )}
          <Field label={entryType === 'event' ? 'Event date & time' : 'Start time'} hint="Auto-filled">
            <TextInput value={selectedGame ? formatDateTime(selectedGame.gameDate) : ''} readOnly placeholder="—" />
          </Field>
        </div>

        {isEmployee ? (
          <Field label="Employee name" required>
            <TextInput
              value={empName}
              onChange={(e) => {
                setEmpName(e.target.value);
                if (!quantityTouched) setQuantity(e.target.value.trim() ? '1' : '');
              }}
              placeholder="Jane Smith"
            />
          </Field>
        ) : (
          <CrmPicker onChange={handleCrmChange} />
        )}

        {beneficiariesCount > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap gap-1.5">
              {(isEmployee ? [empName] : (sel?.contacts ?? []).map((c) => c.fullName)).map((name, i) => (
                <span key={`${name}-${i}`} className="inline-flex items-center rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                  {name}
                </span>
              ))}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {isEmployee ? 'AIS employee' : sel?.account.name}
              {!isEmployee && sel?.opportunity && (
                <> · Opportunity: <span className="font-medium text-slate-700">{sel.opportunity.name}</span></>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Quantity" required hint="Defaults to number of beneficiaries">
            <TextInput
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                setQuantityTouched(true);
              }}
              required
            />
          </Field>
          {!isEmployee && (
            <Field label="Revenue — Manual Rep Credit (USD)" hint="From the selected opportunity">
              <TextInput type="number" min="0" step="100" value={salesOpportunityUsd} onChange={(e) => setSalesOpportunityUsd(e.target.value)} />
            </Field>
          )}
        </div>

        <Field label="Notes">
          <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorNote error={create.error} />
      </form>
    </Modal>
  );
}

function ImportRequestsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const games = useGamesForSelect();
  const [gameId, setGameId] = useState('');
  const [rawText, setRawText] = useState('');

  const importReq = useMutation({
    mutationFn: async () => {
      const res = await api.post('/requests/import', {
        gameId: gameId ? Number(gameId) : undefined,
        rawText,
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
    },
  });

  const preview = pickArray<Record<string, unknown>>(importReq.data, 'requests', 'created', 'parsed', 'results');

  return (
    <Modal
      open
      onClose={onClose}
      title="Import requests from email"
      description="Paste raw email text; the intake adapter parses each request block."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button loading={importReq.isPending} disabled={!rawText.trim()} onClick={() => importReq.mutate()}>
            Parse &amp; import
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Game (optional)" hint="Associate all parsed requests with a specific game">
          <Select value={gameId} onChange={(e) => setGameId(e.target.value)}>
            <option value="">Auto / none</option>
            {games.data?.map((g) => (
              <option key={g.id} value={g.id}>
                #{g.id} · vs {g.opponent}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Raw email text" required>
          <TextArea
            rows={8}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            className="font-mono text-xs"
            placeholder={'From: john@acme.com\nCan I get 4 tickets to the Friday game for our client...'}
          />
        </Field>

        {importReq.isSuccess && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Import complete. {preview.length > 0 ? `${preview.length} request(s) parsed.` : 'See Requests list for results.'}
          </div>
        )}
        {preview.length > 0 && (
          <pre className="max-h-48 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            {JSON.stringify(preview, null, 2)}
          </pre>
        )}
        <ErrorNote error={importReq.error} />
      </div>
    </Modal>
  );
}
