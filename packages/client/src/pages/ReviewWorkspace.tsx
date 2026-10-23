import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type RequestOptions, type FollowupTemplate, type CreateRequestInput, type ReviewInventoryItem as Game } from '@ais/shared';
import { api } from '@/lib/api';
import type { TicketRequest, Assignment } from '@/lib/types';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/Button';
import { Field, TextInput, TextArea, Select } from '@/components/Field';
import { Modal } from '@/components/Modal';
import { QueryState, ErrorNote } from '@/components/QueryState';
import { RankingPanel } from '@/pages/game/RankingPanel';

const date = (ms: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(ms) + ' UTC';
const label = (g: Game) => g.title ?? `${g.teamName ?? 'Game'} · ${g.opponent}`;
interface Job { path: string; body: unknown; method?: 'post' | 'put' | 'patch' }
type ReviewRequest = Pick<TicketRequest, 'id' | 'gameId' | 'quantity' | 'status' | 'beneficiaryType' | 'requesterName' | 'requesterCompany' | 'notes' | 'createdAt'> & Partial<TicketRequest> & { beneficiaryNoShowCount?: number; beneficiaries?: { id:number; fullName:string; phone:string | null; email:string | null; noShowCount:number }[]; crmOpportunityName?: string | null };

function useReviewAction() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ path, body, method = 'post' }: Job) => (await api.request({ method, url: path, data: body })).data,
    onSuccess: () => qc.invalidateQueries() });
}
export function ReviewWorkspace() {
  const { hasRole } = useAuth();
  const admin = hasRole('admin');
  const [params, setParams] = useSearchParams();
  const view = admin ? params.get('view') ?? 'inventory' : 'inventory';
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [showPast, setShowPast] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [interest, setInterest] = useState<Game | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const games = useQuery({ queryKey: ['review-games'], queryFn: async () => (await api.get<{ games: Game[] }>('/games')).data.games, refetchInterval: 30_000 });
  const requests = useQuery({ queryKey: ['review-requests'], queryFn: async () => (await api.get<{ requests: ReviewRequest[] }>('/requests')).data.requests });
  const allocated = useQuery({ queryKey: ['review-assignments'], queryFn: async () => (await api.get<{ assignments: Assignment[] }>('/assignments')).data.assignments, enabled: admin });
  const gameId = Number(params.get('game') ?? 0);
  const filtered = (games.data ?? []).filter((g) => (showPast || g.gameDate >= Date.now()) && (!kind || g.kind === kind) && label(g).toLowerCase().includes(search.toLowerCase()));
  const changeView = (next: string, target?: number) => { setNotice(''); setParams({ view: next, ...(target ? { game: String(target) } : {}) }); };
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-700">{admin ? 'Coordinator tools' : 'Express interest'}</p><h1 className="text-3xl font-semibold tracking-tight text-slate-900">{admin ? 'Make every ticket count' : 'Find your next event'}</h1><p className="mt-2 max-w-2xl text-sm text-slate-600">{admin ? 'Stage inventory, release a window, review interest, then record manual transfers and attendance.' : 'See released games and events. Requests express interest; a coordinator decides who receives tickets.'}</p></div>
      {admin && <div className="flex flex-wrap gap-2"><Link className="rounded-lg border bg-white px-3 py-2 text-sm" to="/teams">Set up sports / import CSV</Link><Button onClick={() => setEventOpen(true)}>Add dated event</Button></div>}
    </div>
    {admin && <nav aria-label="Workflow steps" className="flex flex-wrap gap-2">{[['inventory', '1 · Inventory & release'], ['review', '2 · Review interest'], ['followthrough', '3 · Transfers & attendance'], ['messages', 'Mock messages']].map(([key, text]) => <button key={key} className={`rounded-lg px-4 py-2 text-sm font-medium ${view === key ? 'bg-slate-900 text-white' : 'border bg-white text-slate-700 hover:bg-slate-50'}`} onClick={() => changeView(key)} aria-current={view === key ? 'page' : undefined}>{text}</button>)}</nav>}
    {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {view === 'inventory' && <>
      <div className="card flex flex-wrap items-end gap-4 p-4">
        <Field label="Find an event" className="min-w-48 flex-1"><TextInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Team, opponent or event…" /></Field>
        <Field label="Event type"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All types</option><option value="game">Sports games</option><option value="event">Dated events</option></Select></Field>
        {admin && <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />Include past inventory</label>}
        <Button variant="secondary" onClick={() => { setSearch(''); setKind(''); setSelected([]); }}>Clear filters & selection</Button>
      </div>
      {admin && <ReleasePanel selected={selected} onDone={() => { setSelected([]); setNotice('Release settings saved. No announcement was sent.'); }} />}
      <QueryState isLoading={games.isLoading} error={games.error}>
        {filtered.length === 0 ? <Empty title={admin ? 'No matching inventory' : 'No released events yet'} detail={admin ? 'Add a dated event or set up a sports team. Clear filters to see other inventory.' : 'The coordinator will release more dates. Check back later.'} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((g) => <article key={g.id} className="card flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium uppercase text-slate-500">{g.kind === 'event' ? 'Dated event' : 'Sports game'}</p><h2 className="mt-1 break-words text-lg font-semibold text-slate-900">{label(g)}</h2><p className="mt-1 text-sm text-slate-600">{date(g.gameDate)}</p></div>{admin && <input aria-label={`Select ${label(g)}`} className="mt-1 h-5 w-5" type="checkbox" checked={selected.includes(g.id)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, g.id] : s.filter((id) => id !== g.id))} />}</div>
          {admin && <p className={`rounded-md px-2 py-1 text-xs font-semibold ${g.released ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{g.released ? 'Released to requesters' : g.releaseStatus === 'scheduled' ? `Scheduled: ${date(g.releaseAt!)}` : 'Private · coordinator only'}</p>}
          <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Available tickets</dt><dd className="text-2xl font-semibold tabular-nums">{g.availableSeats ?? 0}<span className="ml-1 text-sm font-normal text-slate-500">/ {g.totalSeats}</span></dd></div><div><dt className="text-slate-500">Interest</dt><dd className="mt-1 font-semibold">{g.requestCount ?? 0} requests · {g.requestingPeople ?? 0} people</dd><dd>{g.requestedTickets ?? 0} tickets requested</dd></div></dl>
          <div className="mt-auto flex flex-wrap gap-2"><Button size="sm" onClick={() => setInterest(g)} disabled={['completed', 'cancelled'].includes(g.status)}>{admin ? 'Record interest' : 'Express interest'}</Button>{admin && <><Button size="sm" variant="secondary" onClick={() => changeView('review', g.id)}>Review & assign</Button><Link className="px-2 py-2 text-xs text-brand-700 underline" to={`/games/${g.id}`}>Inventory details</Link></>}</div>
        </article>)}</div>}
      </QueryState>
      <p className="text-xs text-slate-500">People = distinct submitting app identities (including coordinator-selected people). Tickets = quantities requested, not confirmed attendees. Interest totals include fulfilled requests and exclude declined/cancelled requests. Other requesters’ personal details stay private.</p>
      {!admin && <section className="card p-5"><h2 className="mb-3 text-lg font-semibold">Your interest</h2><QueryState isLoading={requests.isLoading} error={requests.error}>{!requests.data?.length ? <p className="text-sm text-slate-500">You have no requests yet. Choose an event above to express interest.</p> : <ul className="divide-y">{requests.data.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{games.data?.find((g) => g.id === r.gameId) ? label(games.data.find((g) => g.id === r.gameId)!) : 'Previously requested inventory'} · {r.quantity} tickets</span><span className="font-medium">{r.status.replace(/_/g, ' ')}</span></li>)}</ul>}</QueryState></section>}
    </>}
    {admin && view === 'review' && <>
      <div className="flex flex-wrap gap-4 text-sm text-brand-700"><Link to="/requests" className="underline">Detailed request queue</Link><Link to="/waitlist" className="underline">Manage waitlist</Link><Link to="/dashboard" className="underline">Reports</Link></div>
      <GameFilter games={games.data ?? []} value={gameId} onChange={(id) => changeView('review', id)} />
      <p className="text-sm text-slate-600">Scores are advisory and visible only here. Choose any active request, including pre-release interest or a waitlisted request, and record the reason for your decision.</p>
      {gameId > 0 && <RankingPanel gameId={gameId} />}
      <QueryState isLoading={requests.isLoading || allocated.isLoading} error={requests.error || allocated.error}>
        {!(requests.data ?? []).filter((r) => (!gameId || r.gameId === gameId) && !['cancelled', 'declined'].includes(r.status)).length ? <Empty title="No open interest" detail="Record interest from inventory, or switch to a requester persona and choose released inventory." /> : <div className="space-y-3">{requests.data?.filter((r) => (!gameId || r.gameId === gameId) && !['cancelled', 'declined'].includes(r.status)).map((r) => <RequestReview key={r.id} request={r} game={games.data?.find((g) => g.id === r.gameId)} assignments={allocated.data ?? []} onDone={setNotice} />)}</div>}
      </QueryState>
    </>}
    {admin && view === 'followthrough' && <>
      <GameFilter games={games.data ?? []} value={gameId} onChange={(id) => changeView('followthrough', id)} />
      <p className="text-sm text-slate-600">Transfer tickets manually in the provider app using the contact details below, then record that step here. An unanswered follow-up or missing photo leaves attendance unknown.</p>
      <QueryState isLoading={allocated.isLoading} error={allocated.error}>{!allocated.data?.filter((a) => (!gameId || a.gameId === gameId) && ['approved', 'transferred'].includes(a.status)).length ? <Empty title="No allocations to follow up" detail="Review interest and assign tickets first." /> : <div className="grid gap-4 md:grid-cols-2">{allocated.data.filter((a) => (!gameId || a.gameId === gameId) && ['approved', 'transferred'].includes(a.status)).map((a) => <FollowThrough key={a.id} assignment={a} game={games.data?.find((g) => g.id === a.gameId)} onDone={setNotice} />)}</div>}</QueryState>
    </>}
    {admin && view === 'messages' && <Messages />}
    {interest && <InterestForm game={interest} onClose={() => setInterest(null)} onDone={() => { setInterest(null); setNotice('Interest recorded. No tickets were allocated or transferred.'); }} />}
    {eventOpen && <AddEvent onClose={() => setEventOpen(false)} onDone={() => { setEventOpen(false); setNotice('Dated event created privately. Select it when you are ready to release it.'); }} />}
  </div>;
}
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="card p-8 text-center"><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm text-slate-500">{detail}</p></div>; }
function GameFilter({ games, value, onChange }: { games: Game[]; value: number; onChange: (id: number) => void }) {
  return <Field label="Inventory selection"><Select value={value || ''} onChange={(e) => onChange(Number(e.target.value))}><option value="">All inventory</option>{games.map((g) => <option key={g.id} value={g.id}>{label(g)} · {date(g.gameDate)}</option>)}</Select></Field>;
}
function ReleasePanel({ selected, onDone }: { selected: number[]; onDone: () => void }) {
  const job = useReviewAction();
  const [scope, setScope] = useState('selected');
  const [from, setFrom] = useState('');
  const [through, setThrough] = useState('');
  const [action, setAction] = useState('release');
  const [at, setAt] = useState('');
  return <form className="card space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); job.mutate({ path: '/review/releases', body: { ...(scope === 'selected' ? { gameIds: selected } : { from: `${from}T00:00:00Z`, through: `${through}T23:59:59.999Z` }), action, ...(action === 'schedule' ? { releaseAt: `${at}:00Z` } : {}) } }, { onSuccess: onDone }); }}>
    <div className="flex flex-wrap items-end gap-3"><Field label="Release scope"><Select value={scope} onChange={(e) => setScope(e.target.value)}><option value="selected">Selected inventory ({selected.length})</option><option value="window">Date window (all teams & events)</option></Select></Field>
      {scope === 'window' && <><Field label="Event dates from (UTC)"><TextInput type="date" required value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="Through (UTC, inclusive)"><TextInput type="date" required value={through} min={from} onChange={(e) => setThrough(e.target.value)} /></Field></>}
      <Field label="Visibility action"><Select value={action} onChange={(e) => setAction(e.target.value)}><option value="release">Release now</option><option value="schedule">Schedule release</option><option value="private">Keep private / withdraw release</option></Select></Field>
      {action === 'schedule' && <Field label="Release at (UTC)"><TextInput type="datetime-local" required value={at} onChange={(e) => setAt(e.target.value)} /></Field>}
      <Button type="submit" loading={job.isPending} disabled={scope === 'selected' && !selected.length}>Save release settings</Button>
    </div><p className="text-xs text-slate-500">All entry times here are UTC, including the date picker. Scheduled eligibility begins at that exact instant and is checked by the server. Existing allocations stay intact. Announcements are a separate choice.</p><ErrorNote error={job.error} />
  </form>;
}
function InterestForm({ game, onClose, onDone }: { game: Game; onClose: () => void; onDone: () => void }) {
  const { hasRole, user } = useAuth();
  const admin = hasRole('admin');
  const options = useQuery({ queryKey: ['request-options'], queryFn: async () => (await api.get<RequestOptions>('/request-options')).data });
  const [purpose, setPurpose] = useState<'customer' | 'employee'>(user.role === 'employee' ? 'employee' : 'customer');
  const [company, setCompany] = useState('');
  const [chosen, setChosen] = useState<number[]>([]);
  const [quantity, setQuantity] = useState(2);
  const [notes, setNotes] = useState('');
  const [opportunity, setOpportunity] = useState('');
  const [requester, setRequester] = useState('');
  const job = useReviewAction();
  const contacts = (options.data?.contacts ?? []).filter((c) => c.type === purpose);
  const companies = [...new Set(contacts.map((c) => c.company ?? '').filter(Boolean))];
  const eligible = contacts.filter((c) => purpose === 'employee' || c.company === company);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const selected = chosen.map((id) => contacts.find((c) => c.id === id)!);
    const body: CreateRequestInput = { gameId: game.id, beneficiaryType: purpose, beneficiaryContactId: chosen[0], ...(chosen.length > 1 ? { beneficiaryContacts: selected.map((c) => ({ ...c, company: c.company ?? undefined, email: c.email ?? undefined, phone: c.phone ?? undefined, localContactId: c.id })) } : {}), quantity, notes, crmOpportunityName: opportunity || undefined, ...(requester ? { onBehalfUserId: Number(requester) } : {}) };
    job.mutate({ path: '/requests', body }, { onSuccess: onDone });
  };
  return <Modal open onClose={onClose} title={admin ? 'Record interest on behalf of someone' : 'Express interest'} description={`${label(game)} · ${date(game.gameDate)}`} size="lg"><QueryState isLoading={options.isLoading} error={options.error}><form onSubmit={submit} className="space-y-4">
    <p className="rounded-lg bg-brand-50 p-3 text-sm text-brand-900">This records interest only. Ticket availability and priority scores do not guarantee allocation.</p>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Purpose"><Select value={purpose} onChange={(e) => { setPurpose(e.target.value as 'customer' | 'employee'); setChosen([]); setCompany(''); }}><option value="employee">Employee / self</option>{user.role !== 'employee' && <option value="customer">Customer / prospect</option>}</Select></Field><Field label="Tickets requested"><TextInput type="number" min={1} max={100} required value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></Field></div>
    {admin && <Field label="Requesting person (optional)"><Select value={requester} onChange={(e) => setRequester(e.target.value)}><option value="">Record as coordinator</option>{options.data?.requesterUsers?.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select></Field>}
    {purpose === 'customer' && <Field label="Customer / business"><Select required value={company} onChange={(e) => { setCompany(e.target.value); setChosen([]); }}><option value="">Select customer…</option>{companies.map((c) => <option key={c}>{c}</option>)}</Select></Field>}
    <fieldset className="rounded-lg border p-3"><legend className="px-1 text-sm font-medium">{purpose === 'customer' ? 'Contacts attending' : 'Employee beneficiary'}</legend>{eligible.length ? eligible.map((c) => <label key={c.id} className="flex items-start gap-3 py-2 text-sm"><input className="mt-1" type="checkbox" checked={chosen.includes(c.id)} onChange={(e) => setChosen((ids) => e.target.checked ? [...ids, c.id] : ids.filter((id) => id !== c.id))} /><span>{c.fullName}<span className="block text-xs text-slate-500">{c.phone || 'Phone not yet recorded'} · {c.email || 'No email'}</span></span></label>) : <p className="text-sm text-slate-500">{purpose === 'customer' && !company ? 'Select a business to see its active contacts.' : 'No active contacts are available. Ask a coordinator to update the local repository.'}</p>}</fieldset>
    {purpose === 'customer' && <Field label="Related opportunity (optional)" hint="Name or short context; value / MRR may be included in your rationale. No CRM financial validation is required."><TextInput value={opportunity} maxLength={200} onChange={(e) => setOpportunity(e.target.value)} /></Field>}
    <Field label="Concise business justification" required><TextArea required maxLength={1000} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={purpose === 'employee' ? 'Why would you like to attend?…' : 'Customer relationship, opportunity or business purpose…'} /></Field>
    {chosen.length > quantity && <p role="alert" className="text-sm text-rose-700">Request at least one ticket per selected contact.</p>}<ErrorNote error={job.error} />
    <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={job.isPending} disabled={!chosen.length || chosen.length > quantity}>Record interest</Button></div>
  </form></QueryState></Modal>;
}
function RequestReview({ request: r, game, assignments, onDone }: { request: ReviewRequest; game?: Game; assignments: Assignment[]; onDone: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const held = assignments.filter((a) => a.requestId === r.id && ['proposed', 'approved', 'transferred'].includes(a.status)).length;
  const [quantity, setQuantity] = useState(Math.max(1, r.quantity - held));
  const job = useReviewAction();
  return <article className="card p-5"><div className="flex flex-wrap justify-between gap-4"><div><h2 className="font-semibold">{r.requesterName ?? 'Local interest'} <span className="text-sm font-normal text-slate-500">· {r.requesterCompany ?? r.beneficiaryType}</span></h2><p className="mt-1 text-sm">{game ? label(game) : `Inventory #${r.gameId}`} · {r.quantity} requested · {held} allocated · {r.status.replace(/_/g, ' ')}</p><p className="mt-2 max-w-3xl whitespace-pre-wrap break-words text-sm text-slate-600">{r.notes}</p>{r.crmOpportunityName && <p className="mt-1 text-sm text-slate-500">Opportunity: {r.crmOpportunityName}</p>}<p className="mt-1 text-xs text-slate-500">Transfer contact: {r.requesterPhone || 'Phone not recorded'} · {r.requesterEmail || 'Email not recorded'}</p>{r.beneficiaries && r.beneficiaries.length > 1 && <p className="mt-2 text-xs text-slate-500">Contacts: {r.beneficiaries.map((c) => `${c.fullName}${c.noShowCount ? ' (confirmed no-show history)' : ''}`).join(', ')}</p>}{Boolean(r.beneficiaryNoShowCount) && <p className="mt-2 text-xs font-medium text-amber-800">Coordinator reliability flag: {r.beneficiaryNoShowCount} confirmed no-show record(s). Review history and use discretion.</p>}</div><div className="flex flex-wrap items-start gap-2"><Button size="sm" disabled={held >= r.quantity} onClick={() => { setQuantity(Math.max(1, r.quantity - held)); setOpen(true); }}>Assign tickets</Button><Button size="sm" variant="secondary" loading={job.isPending} disabled={r.status === 'waitlisted' || held > 0} onClick={() => job.mutate({ path: '/waitlist', body: { gameId: r.gameId, requestId: r.id } }, { onSuccess: () => onDone('Interest added to the waitlist. No tickets allocated.') })}>Waitlist</Button></div></div><ErrorNote error={job.error} />
    {open && <Modal open title="Coordinator allocation decision" onClose={() => setOpen(false)}><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); job.mutate({ path: '/review/allocate', body: { requestId: r.id, quantity, reason } }, { onSuccess: () => { setOpen(false); onDone('Allocation recorded. Complete ticket transfer manually in the provider app.'); } }); }}><p className="text-sm">Choose a quantity up to the remaining request. You may override advisory ranking. Allocation succeeds only if the inventory is available.</p><Field label="Tickets to assign"><TextInput type="number" min={1} max={r.quantity - held} value={quantity} required onChange={(e) => setQuantity(Number(e.target.value))} /></Field><Field label="Decision / override reason"><TextArea rows={3} required maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field><ErrorNote error={job.error} /><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={job.isPending}>Record allocation</Button></div></form></Modal>}
  </article>;
}
function FollowThrough({ assignment: a, game, onDone }: { assignment: Assignment; game?: Game; onDone: (text: string) => void }) {
  const [mode, setMode] = useState<'transfer' | 'attendance' | null>(null);
  const [reference, setReference] = useState('');
  const [outcome, setOutcome] = useState('unknown');
  const [note, setNote] = useState('');
  const job = useReviewAction();
  return <article className="card space-y-3 p-5"><div><h2 className="font-semibold">{a.requesterName} · {a.seatLabel}</h2><p className="text-sm text-slate-600">{game ? label(game) : `Inventory #${a.gameId}`}</p><p className="mt-2 text-sm">Phone: {a.requesterPhone || 'Not recorded'}<br />Email: {a.requesterEmail || 'Not recorded'}</p></div><p className="text-sm">Manual transfer: <b>{a.status === 'transferred' ? 'Recorded locally' : 'Not recorded'}</b><br />Attendance: <b>{a.attendanceStatus === 'no_show' ? 'Confirmed no-show' : a.attendanceStatus === 'attended' ? 'Attended' : 'Unknown'}</b></p><div className="flex flex-wrap gap-2">{a.status === 'approved' && <Button size="sm" onClick={() => setMode('transfer')}>Record manual transfer</Button>}<Button size="sm" variant="secondary" onClick={() => setMode('attendance')}>Update attendance</Button>{a.beneficiaryContactId && <Link className="px-2 py-2 text-sm text-brand-700 underline" to={`/contacts?contact=${a.beneficiaryContactId}`}>Contact history</Link>}</div>
    {mode && <Modal open onClose={() => setMode(null)} title={mode === 'transfer' ? 'Record an external manual transfer' : 'Record attendance evidence'}><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); job.mutate(mode === 'transfer' ? { path: '/review/manual-transfer', body: { assignmentId: a.id, confirmed: true, reference } } : { path: `/assignments/${a.id}/attendance`, body: { ticketStatus: outcome, followUpNotes: note } }, { onSuccess: () => { setMode(null); onDone(mode === 'transfer' ? 'Manual transfer recorded locally. No provider was contacted.' : 'Attendance updated. Unknown outcomes do not count as no-shows.'); } }); }}>
      {mode === 'transfer' ? <><p className="text-sm">Complete the ticket transfer in the provider app first. This app records your confirmation and cannot deliver tickets.</p><Field label="Manual reference / note"><TextInput required maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} /></Field><label className="flex items-start gap-2 text-sm"><input required type="checkbox" />I completed the manual transfer outside this app (synthetic review simulation).</label></> : <><Field label="Attendance outcome"><Select value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="unknown">Unknown / no evidence</option><option value="attended">Attended</option><option value="no_show">Confirmed no-show</option></Select></Field><Field label="Evidence / coordinator note" hint="A confirmed no-show requires an explicit note. No photo is required."><TextArea required={outcome === 'no_show'} value={note} rows={3} onChange={(e) => setNote(e.target.value)} /></Field></>}
      <ErrorNote error={job.error} /><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setMode(null)}>Cancel</Button><Button type="submit" loading={job.isPending}>Save local record</Button></div>
    </form></Modal>}
  </article>;
}
function AddEvent({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(''); const [at, setAt] = useState(''); const [tickets, setTickets] = useState(4); const [description, setDescription] = useState(''); const job = useReviewAction();
  return <Modal open onClose={onClose} title="Add a dated event" description="A concert, performance or one-off event. No season setup required."><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); job.mutate({ path: '/events', body: { title, description, date: `${at}:00Z`, tickets } }, { onSuccess: onDone }); }}><Field label="Event title"><TextInput required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></Field><Field label="Date & time (UTC)"><TextInput type="datetime-local" required value={at} onChange={(e) => setAt(e.target.value)} /></Field><Field label="Ticket inventory"><TextInput type="number" min={0} max={1000} required value={tickets} onChange={(e) => setTickets(Number(e.target.value))} /></Field><Field label="Description (optional)"><TextArea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field><p className="text-sm text-slate-500">New inventory starts private. Release it separately when ready.</p><ErrorNote error={job.error} /><Button type="submit" loading={job.isPending}>Create private event</Button></form></Modal>;
}
interface OutboxItem { id: number; kind: string; subject: string; body: string; audience: string; created_at: number }
function Messages() {
  const preview = useQuery({ queryKey: ['review-availability'], queryFn: async () => (await api.get<{ message: string; availableSeats: number }>('/notifications/availability')).data });
  const followup = useQuery({ queryKey: ['review-followup'], queryFn: async () => (await api.get<{ template: FollowupTemplate }>('/review/followup')).data.template });
  const outbox = useQuery({ queryKey: ['review-outbox'], queryFn: async () => (await api.get<{ messages: OutboxItem[] }>('/review/outbox')).data.messages });
  return <div className="space-y-5"><p className="text-sm text-slate-600">Coordinator initiated previews only. Release never sends a message. No SMS, automatic game-day reminders, external email, photo upload or subscription is enabled.</p><QueryState isLoading={preview.isLoading} error={preview.error}>{preview.data && <AvailabilityComposer key={preview.data.message} message={preview.data.message} />}</QueryState><QueryState isLoading={followup.isLoading} error={followup.error}>{followup.data && <FollowupComposer key={JSON.stringify(followup.data)} initial={followup.data} />}</QueryState><section className="card p-5"><h2 className="text-lg font-semibold">Mock outbox · nothing delivered</h2><QueryState isLoading={outbox.isLoading} error={outbox.error}>{!outbox.data?.length ? <p className="mt-2 text-sm text-slate-500">No mock messages. Choose when to add a preview above.</p> : <ul className="divide-y">{outbox.data.map((m) => <li key={m.id} className="space-y-1 py-3 text-sm"><h3 className="font-semibold">{m.subject}</h3><p className="text-xs text-slate-500">{m.kind} · {m.audience} · {date(m.created_at)} · Local simulation only</p><p className="whitespace-pre-wrap break-words">{m.body}</p></li>)}</ul>}</QueryState></section></div>;
}
function AvailabilityComposer({ message }: { message: string }) {
  const [body, setBody] = useState(message); const [audience, setAudience] = useState('sales_team'); const job = useReviewAction();
  return <form className="card space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); job.mutate({ path: '/notifications/availability', body: { audience, message: body } }); }}><h2 className="text-lg font-semibold">Availability announcement preview</h2><Field label="Synthetic audience"><Select value={audience} onChange={(e) => setAudience(e.target.value)}><option value="sales_team">Sales team (mock)</option><option value="everyone">Everyone (mock)</option></Select></Field><Field label="Message preview"><TextArea required rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} /></Field><ErrorNote error={job.error} />{job.isSuccess && <p role="status" className="text-sm text-emerald-700">Added to the local mock outbox. Nothing was sent.</p>}<Button type="submit" loading={job.isPending}>Add availability preview to mock outbox</Button></form>;
}
function FollowupComposer({ initial }: { initial: FollowupTemplate }) {
  const [template, setTemplate] = useState(initial); const job = useReviewAction();
  return <form className="card space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); job.mutate({ method: 'put', path: '/review/followup', body: template }); }}><h2 className="text-lg font-semibold">Optional post-event follow-up</h2><p className="text-sm text-slate-500">Disabled by default. Saving this template enables only a manual local mock preview. Photo requirements and real delivery need separate acceptance.</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={template.enabled} onChange={(e) => setTemplate((t) => ({ ...t, enabled: e.target.checked }))} />Enable local follow-up mock flow</label><Field label="Subject"><TextInput required maxLength={200} value={template.subject} onChange={(e) => setTemplate((t) => ({ ...t, subject: e.target.value }))} /></Field><Field label="Preview body"><TextArea required maxLength={2000} rows={3} value={template.body} onChange={(e) => setTemplate((t) => ({ ...t, body: e.target.value }))} /></Field><ErrorNote error={job.error} /><div className="flex flex-wrap gap-2"><Button type="submit" loading={job.isPending}>Save local template</Button><Button type="button" variant="secondary" disabled={!initial.enabled} loading={job.isPending} onClick={() => job.mutate({ path: '/review/followup/outbox', body: {} })}>Add saved follow-up to mock outbox</Button></div>{job.isSuccess && <p role="status" className="text-sm text-emerald-700">Local mock setting or preview saved. Nothing was delivered.</p>}</form>;
}
