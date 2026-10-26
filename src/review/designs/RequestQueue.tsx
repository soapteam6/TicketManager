import { requesterIdentity } from './requesterIdentity';
import { useState } from 'react';
import { useReview } from '../context';
import { dateTime, number, value } from '../form';
import { beneficiaryNames, personName } from '../personName';
import { RequestIdentity } from '../RequestIdentity';
import type { InterestView } from '../types';
import { Button, Field, FormError, TextArea, TextInput } from '../ui';
import { Capacity, EmptyRows, Glyph, Search, Status } from './parts';
import { rowSelection } from './rowSelection';

function Decision({ request }: { request: InterestView }) {
  const { snapshot, busy, run } = useReview();
  const game = snapshot.catalog.find(g => g.id === request.gameId);
  const remaining = request.quantity - request.allocated;
  const maximum = Math.min(remaining, game?.availableTickets ?? 0);
  const active = !['cancelled', 'fulfilled'].includes(request.status);
  return <section className="work-decision">
    <h3>Allocation decision</h3>
    <p className="work-help">Record the quantity and your reason. Scoring is advisory.</p>
    {game && <Capacity gameId={game.id} compact />}
    {active && remaining > 0 ? <form key={`${request.id}-${request.allocated}`} onSubmit={async e => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      await run({ type: 'allocate', requestId: request.id, quantity: number(data, 'quantity'), reason: value(data, 'reason') });
    }}>
      <FormError />
      <Field label="Tickets to allocate" required><TextInput name="quantity" type="number" min={1} max={maximum || 1} defaultValue={Math.max(1, maximum)} required disabled={busy || !maximum} /></Field>
      <Field label="Decision reason" required><TextArea name="reason" rows={4} maxLength={1000} placeholder="Why is this allocation appropriate?" required /></Field>
      <Button type="submit" disabled={busy || !maximum}>Allocate tickets</Button>
      {!maximum && <p className="work-help">No tickets are available for this event.</p>}
      <Button type="button" variant="secondary" disabled={busy || request.allocated > 0 || request.status === 'waitlisted'} onClick={() => run({ type: 'waitlist', requestId: request.id })}>{request.status === 'waitlisted' ? 'Already waitlisted' : 'Move to waitlist'}</Button>
      <p className="work-help">Waitlisting holds no tickets. Transfer is completed manually after allocation.</p>
    </form> : <div className="work-completed"><Status value={request.status} /><p>{request.allocated} of {request.quantity} requested tickets allocated.</p><p className="work-help">Manage transfer and attendance in the allocation register.</p></div>}
  </section>;
}

function RequestDetail({ request, desk, onClose }: { request: InterestView; desk: boolean; onClose: () => void }) {
  const { snapshot, provider, persona } = useReview();
  const admin = snapshot.persona.role === 'coordinator';
  const game = snapshot.catalog.find(g => g.id === request.gameId);
  const identity = requesterIdentity(request, snapshot);
  const score = admin ? provider.rank(persona, request.gameId).ranked.find(r => r.requestId === request.id) : undefined;
  const contacts = request.contactIds?.map(id => snapshot.contacts?.find(c => c.id === id)).filter(c => c !== undefined) ?? [];
  return <div className={`work-request-content ${desk && admin ? 'with-decision' : ''}`}>
    <article className="work-request-detail" aria-label="Selected request">
      <div className="work-inspector-heading"><span>Request details</span><button className="work-icon-button" aria-label="Close request details" onClick={onClose}><Glyph name="close" size={16} /></button></div>
      <div className="work-detail-title"><div><span className="work-record-type">{request.purpose === 'customer' ? 'Customer request' : 'Employee request'}</span><h2>{identity.name}</h2><p>{identity.email || 'Email not recorded'}</p></div><Status value={request.status} /></div>
      <div className="work-request-event"><Glyph name="inventory" size={20} /><div><h3>{game?.title ?? 'Historical event'}</h3><p>{game ? dateTime(game.gameDate) : 'Date unavailable'}{game?.seasonLabel ? ` · ${game.seasonLabel}` : ''}</p></div></div>
      <dl className="work-quantity-strip"><div><dt>Requested</dt><dd>{request.quantity}</dd></div><div><dt>Allocated</dt><dd>{request.allocated}</dd></div><div><dt>Outstanding</dt><dd>{Math.max(0, request.quantity - request.allocated)}</dd></div></dl>
      <section className="work-detail-section"><h3>Business justification</h3><p className="preserve-lines">{request.rationale}</p>{request.opportunity && <p><span className="muted">Opportunity: </span>{request.opportunity}</p>}</section>
      <section className="work-detail-section"><h3>Beneficiaries</h3>{contacts.length ? <ul className="work-person-list">{contacts.map(contact => <li key={contact.id}><span className="work-person-initial" aria-hidden="true">{personName(contact.name).slice(0, 1)}</span><div><strong title={contact.name}>{personName(contact.name)}</strong><span>{contact.email || 'Email not recorded'}</span><small>{contact.company}{contact.phone ? ` · ${contact.phone}` : ''}</small></div></li>)}</ul> : <p>{beneficiaryNames(request, snapshot)}</p>}</section>
      {admin && <section className="work-detail-section"><div className="work-inline-heading"><h3>Advisory assessment</h3>{score && <strong>{score.finalScore.toFixed(2)} <span className="muted">/ 1.00</span></strong>}</div>
        {score ? <div className="work-score-factors">{score.breakdown.filter(f => f.weight > 0).map(f => <details key={f.factor}><summary><span>{f.label}</span><span>{f.normalizedValue.toFixed(2)}</span></summary><p>{f.explanation}</p></details>)}</div> : <p className="work-help">Scoring applies to outstanding active requests.</p>}
        <p className="work-help">{request.confirmedNoShows || 0} confirmed no-show ticket outcomes. Unknown attendance is excluded.</p>
      </section>}
      <footer className="work-request-audit"><RequestIdentity request={request} snapshot={snapshot} /><p>Recorded {dateTime(request.createdAt)}</p></footer>
      {admin && !desk && <Decision request={request} />}
    </article>
    {admin && desk && <aside className="work-decision-column" aria-label="Allocation controls"><Decision request={request} /></aside>}
  </div>;
}

export function RequestQueue({ desk = false, gameId, onGameChange }: {
  desk?: boolean;
  gameId: string;
  onGameChange: (gameId: string) => void;
}) {
  const { snapshot } = useReview();
  const admin = snapshot.persona.role === 'coordinator';
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(admin ? 'pending' : 'all');
  const [selectedId, setSelectedId] = useState<string>();
  const requests = snapshot.requests.filter(r => {
    const identity = requesterIdentity(r, snapshot);
    const game = snapshot.catalog.find(g => g.id === r.gameId);
    return (!gameId || r.gameId === gameId) &&
      (filter === 'all' || filter === 'pending' && !['fulfilled', 'cancelled'].includes(r.status) || r.status === filter) &&
      `${identity.name} ${identity.email} ${r.contactNames} ${game?.title ?? ''} ${r.rationale}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  const selected = requests.find(r => r.id === selectedId);
  return <section className={`work-surface request-surface ${desk ? 'queue-layout' : 'register-layout'}`}>
    <div className="work-section-heading"><div><h2>{admin ? 'Request queue' : 'My requests'}</h2><p>{admin ? 'Review the requester, business context and available inventory before deciding.' : 'Track the status of your ticket requests.'}</p></div><span className="work-count-label">{requests.length} shown</span></div>
    <div className="work-toolbar"><Search value={query} onChange={next => { setQuery(next); setSelectedId(undefined); }} placeholder="Search people, email or events" />
      <select aria-label="Request status" value={filter} onChange={e => { setFilter(e.target.value); setSelectedId(undefined); }}><option value="pending">Needs allocation</option><option value="all">All requests</option><option value="waitlisted">Waitlisted</option><option value="fulfilled">Fulfilled</option><option value="cancelled">Cancelled</option></select>
      <select aria-label="Filter requests by event" value={gameId} onChange={e => { onGameChange(e.target.value); setSelectedId(undefined); }}><option value="">All events</option>{snapshot.catalog.map(g => <option value={g.id} key={g.id}>{g.title}</option>)}</select>
    </div>
    {!requests.length ? <EmptyRows>Change the filters or record interest from event inventory.</EmptyRows> : <div className={`work-request-split ${selected ? 'has-focused-request' : ''}`}>
      {desk && selected ? <div className="work-queue-list" aria-label="Request list">{requests.map(r => {
        const identity = requesterIdentity(r, snapshot);
        const game = snapshot.catalog.find(g => g.id === r.gameId);
        return <button type="button" className={`work-queue-item ${selected?.id === r.id ? 'is-selected' : ''}`} key={r.id} aria-pressed={selected?.id === r.id} onClick={() => setSelectedId(r.id)}>
          <div><strong>{identity.name}</strong><span>{r.quantity - r.allocated} tix</span></div><small>{identity.email || 'Email not recorded'}</small><p>{game?.title ?? 'Historical event'}</p><div><Status value={r.status} /><time>{new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</time></div>
        </button>;
      })}</div> : <div className="work-table-scroll"><table className="work-table work-request-table"><thead><tr><th>Requester</th><th>Event</th><th className="numeric">Tickets</th><th>Status</th><th><span className="sr-only">Review</span></th></tr></thead><tbody>{requests.map(r => {
        const identity = requesterIdentity(r, snapshot);
        return <tr key={r.id} className={selected?.id === r.id ? 'is-selected' : ''} {...rowSelection(selected?.id === r.id, () => setSelectedId(r.id))}><td><button className="work-record-link" onClick={() => setSelectedId(r.id)}>{identity.name}</button><small>{identity.email || 'Email not recorded'}</small></td><td>{snapshot.catalog.find(g => g.id === r.gameId)?.title}<small>{beneficiaryNames(r, snapshot)}</small></td><td className="numeric"><strong>{r.quantity}</strong><small>{r.allocated} allocated</small></td><td><Status value={r.status} /></td><td><button className="work-icon-button" aria-label={`Review request from ${identity.name}`} onClick={() => setSelectedId(r.id)}><Glyph name="chevron" size={16} /></button></td></tr>;
      })}</tbody></table></div>}
      {selected && <RequestDetail key={selected.id} request={selected} desk={desk} onClose={() => setSelectedId(undefined)} />}
    </div>}
  </section>;
}
