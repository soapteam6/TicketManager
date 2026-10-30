import { findEvent } from '../eventHistory';
import { useState } from 'react';
import { useReview } from '../context';
import { personName } from '../personName';
import { FollowthroughPanel } from '../RequestsPanel';
import { EmptyRows, Glyph, Search, Status } from './parts';
import { rowSelection } from './rowSelection';

export function AllocationRegister() {
  const { snapshot } = useReview();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [selectedId, setSelectedId] = useState<string>();
  const allocations = (snapshot.allocations ?? []).filter(a => {
    const contact = snapshot.contacts?.find(c => c.id === a.contactId);
    const game = findEvent(snapshot, a.gameId);
    return (status === 'all' || status === 'active' && a.status !== 'cancelled' || status === a.status) && `${contact?.name} ${contact?.email} ${game?.title}`.toLowerCase().includes(query.toLowerCase());
  });
  const selected = allocations.find(a => a.id === selectedId);
  return <section className="work-surface"><div className="work-section-heading"><div><h2>Allocation register</h2><p>Track manual transfer confirmations and evidence-based attendance.</p></div></div>
    <div className="work-toolbar"><Search value={query} onChange={setQuery} placeholder="Search recipient, email or event" /><select aria-label="Allocation status" value={status} onChange={e => setStatus(e.target.value)}><option value="active">Active allocations</option><option value="all">Include cancelled</option><option value="approved">Awaiting transfer</option><option value="transferred">Transferred</option></select><span className="work-toolbar-count">{allocations.length} tickets</span></div>
    <div className={`work-allocation-split ${selected ? 'has-explicit-focus' : ''}`}>
    <div className="work-table-scroll"><table className="work-table"><thead><tr><th>Recipient</th><th>Event</th><th>Transfer status</th><th>Attendance</th></tr></thead><tbody>{allocations.map(a => {
      const contact = snapshot.contacts?.find(c => c.id === a.contactId);
      return <tr key={a.id} className={selected?.id === a.id ? 'is-selected' : ''} {...rowSelection(selected?.id === a.id, () => setSelectedId(a.id))}><td><button className="work-record-link" onClick={() => setSelectedId(a.id)}>{personName(contact?.name ?? 'Historical contact')}</button><small>{contact?.email}</small></td><td>{findEvent(snapshot, a.gameId)?.title}</td><td><Status value={a.status} /></td><td><Status value={a.outcome} /></td></tr>;
    })}</tbody></table>{!allocations.length && <EmptyRows>No allocations match. Review a request to allocate tickets.</EmptyRows>}</div>
    {selected && <aside className="work-allocation-detail" aria-label="Allocation details"><div className="work-inspector-heading"><strong>Allocation details</strong><button className="work-icon-button" aria-label="Close allocation details" onClick={() => setSelectedId(undefined)}><Glyph name="close" size={16} /></button></div><FollowthroughPanel key={selected.id} assignmentId={selected.id} /></aside>}
    </div>
  </section>;
}
