import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useReview } from '../context';
import { dateTime } from '../form';
import { ContactForm } from '../PeoplePanel';
import { personName } from '../personName';
import type { Contact } from '../types';
import { Button } from '../ui';
import { EmptyRows, Glyph, Search, Status } from './parts';
import { rowSelection } from './rowSelection';

export function PeopleRegister() {
  const { snapshot, run, busy } = useReview();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState<Contact | null | undefined>();
  const contacts = (snapshot.contacts ?? []).filter(c =>
    (type === 'all' || c.type === type) && `${c.name} ${c.email} ${c.company} ${c.phone}`.toLowerCase().includes(query.toLowerCase()),
  ).sort((a, b) => personName(a.name).localeCompare(personName(b.name)));
  const selected = snapshot.contacts?.find(c => c.id === selectedId);
  const allocations = (snapshot.allocations ?? []).filter(a => a.contactId === selectedId);
  return <section className="work-surface">
    <div className="work-section-heading"><div><h2>Contact register</h2><p>Employee eligibility, customer details and cross-season allocation history.</p></div><Button onClick={() => setEditing(null)}>+ Customer contact</Button></div>
    <div className="work-toolbar"><Search value={query} onChange={setQuery} placeholder="Search name, email, business or phone" /><select aria-label="Contact type" value={type} onChange={e => setType(e.target.value)}><option value="all">All contacts</option><option value="employee">Employees</option><option value="customer">Customers</option></select><Button variant="secondary" disabled={busy} onClick={() => run({ type: 'syncDirectory' })}>Sync directory</Button><span className="work-toolbar-count">{contacts.length} contacts</span></div>
    <div className={`work-people-split ${selected ? 'has-inspector' : ''}`}>
    <div className="work-table-scroll"><table className="work-table"><thead><tr><th>Name / email</th><th>Business</th><th>Type</th><th>App eligibility</th><th>Directory</th><th>Actions</th></tr></thead><tbody>{contacts.map(c => <tr key={c.id} className={selectedId === c.id ? 'is-selected' : ''} {...rowSelection(selectedId === c.id, () => setSelectedId(c.id))}><td><button className="work-record-link" title={c.name} onClick={() => setSelectedId(c.id)}>{personName(c.name)}</button><small>{c.email || 'Email not recorded'}</small></td><td>{c.company}<small>{c.phone}</small></td><td>{c.type === 'employee' ? 'Employee' : 'Customer'}</td><td><Status value={c.appActive ? 'active' : 'inactive'} /></td><td>{c.type === 'employee' ? c.directoryActive ? 'Active' : 'Inactive' : 'Not linked'}</td><td><div className="work-row-actions"><button onClick={() => setSelectedId(c.id)}>History</button>{c.type === 'customer' && <button onClick={() => setEditing(c)}>Edit</button>}<button disabled={busy} onClick={() => run({ type: 'contactActive', contactId: c.id, active: !c.appActive })}>{c.appActive ? 'Deactivate' : 'Reactivate'}</button></div></td></tr>)}</tbody></table>{!contacts.length && <EmptyRows>Search by name, email, company or phone, or change the contact type.</EmptyRows>}</div>
    <Modal open={editing !== undefined} onClose={() => setEditing(undefined)} title={editing ? 'Edit customer contact' : 'New customer contact'}>{editing !== undefined && <ContactForm contact={editing ?? undefined} close={() => setEditing(undefined)} />}</Modal>
    {selected && <aside className="work-contact-detail" aria-label="Contact history"><div className="work-inspector-heading"><strong>Contact details</strong><button className="work-icon-button" aria-label="Close contact details" onClick={() => setSelectedId(undefined)}><Glyph name="close" size={16} /></button></div><h3>{personName(selected.name)}</h3><p className="work-help">{selected.email}<br />{selected.company}<br />{selected.phone}</p><h4 className="work-history-heading">Allocation &amp; attendance history</h4>{!allocations.length && <p className="work-help">No allocations recorded. Requests remain in the request queue.</p>}<div className="work-history">{allocations.map(a => {
      const game = snapshot.catalog.find(g => g.id === a.gameId);
      return <article key={a.id}><h3>{game?.title}</h3><p>{game && dateTime(game.gameDate)} · {game?.seasonLabel || 'Independent event'}</p><p><Status value={a.status} /> <Status value={a.outcome} /></p><p>{a.decision}</p><p className="work-help">{a.evidence || 'No attendance confirmation'}</p>{(snapshot.attendanceHistory ?? []).filter(h => h.assignmentId === a.id).map((h, index) => <p className="work-help" key={index}>{dateTime(h.recordedAt)}: {h.outcome.replaceAll('_', ' ')} · {h.evidence || 'No evidence'}</p>)}</article>;
    })}</div></aside>}
    </div>
  </section>;
}
