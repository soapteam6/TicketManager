import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useReview } from '../context';
import { dateTime } from '../form';
import { InterestForm, InventoryForm, ReleasePanel } from '../InventoryPanel';
import { Button } from '../ui';
import { Capacity, EmptyRows, Glyph, Search, Status } from './parts';
import { rowSelection } from './rowSelection';

export function InventoryGrid({ onRequests }: { onRequests: (gameId: string) => void }) {
  const { snapshot, busy } = useReview();
  const admin = snapshot.persona.role === 'coordinator';
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState('all');
  const [period, setPeriod] = useState('scheduled');
  const [descending, setDescending] = useState(false);
  const [focusedId, setFocusedId] = useState<string>();
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [interestId, setInterestId] = useState<string>();
  const [releaseIds, setReleaseIds] = useState<string[] | null>(null);
  const games = snapshot.catalog.filter(g =>
    `${g.title} ${g.seasonLabel ?? ''}`.toLowerCase().includes(query.toLowerCase()) &&
    (period === 'all' || g.status === period) &&
    (visibility === 'all' || (visibility === 'released' ? g.released : !g.released && g.release === visibility)),
  ).sort((a, b) => (Date.parse(a.gameDate) - Date.parse(b.gameDate)) * (descending ? -1 : 1));
  const focused = snapshot.catalog.find(g => g.id === focusedId);
  const interest = snapshot.catalog.find(g => g.id === interestId);
  const allSelected = games.length > 0 && games.every(g => selected.includes(g.id));
  const partial = !allSelected && games.some(g => selected.includes(g.id));
  return <section className="work-surface">
    <div className="work-section-heading"><div><h2>Event inventory</h2><p>Manage capacity, visibility and demand across the schedule.</p></div>
      {admin && <Button onClick={() => setCreating(true)}>+ New event</Button>}</div>
    <div className="work-toolbar">
      <Search value={query} onChange={setQuery} placeholder="Search events or seasons" />
      <select aria-label="Inventory period" value={period} onChange={e => setPeriod(e.target.value)}><option value="scheduled">Scheduled events</option><option value="all">Include history</option></select>
      {admin && <select aria-label="Inventory visibility" value={visibility} onChange={e => setVisibility(e.target.value)}><option value="all">All visibility</option><option value="private">Private</option><option value="released">Released</option><option value="scheduled">Scheduled release</option></select>}
      {admin && <Button variant="secondary" disabled={!selected.length || busy} onClick={() => setReleaseIds(selected)}>Set visibility{selected.length ? ` (${selected.length})` : ''}</Button>}
      <span className="work-toolbar-count">{games.length} events</span>
    </div>
    <div className={`work-grid-and-inspector ${focused ? 'has-inspector' : ''}`}>
      <div className="work-table-scroll"><table className="work-table">
        <thead><tr>{admin && <th className="work-check"><input type="checkbox" aria-label="Select visible events" checked={allSelected} ref={el => { if (el) el.indeterminate = partial; }} onChange={e => setSelected(e.target.checked ? [...new Set([...selected, ...games.map(g => g.id)])] : selected.filter(id => !games.some(g => g.id === id)))} /></th>}
          <th>Event / season</th><th><button className="work-sort" onClick={() => setDescending(!descending)}>Date {descending ? '↓' : '↑'}</button></th><th>Visibility</th><th className="numeric">Available</th><th className="numeric">Demand</th><th><span className="sr-only">Open record</span></th></tr></thead>
        <tbody>{games.map(g => <tr key={g.id} className={focusedId === g.id ? 'is-selected' : ''} {...rowSelection(focusedId === g.id, () => setFocusedId(g.id))}>
          {admin && <td className="work-check"><input type="checkbox" aria-label={`Select ${g.title}`} checked={selected.includes(g.id)} onChange={e => setSelected(e.target.checked ? [...selected, g.id] : selected.filter(id => id !== g.id))} /></td>}
          <td><button className="work-record-link" onClick={() => setFocusedId(g.id)}>{g.title}</button><small>{g.seasonLabel || 'Independent event'}</small></td>
          <td className="nowrap">{dateTime(g.gameDate)}</td>
          <td><Status value={g.released ? 'released' : g.release}>{g.released ? 'Released' : g.release === 'scheduled' ? 'Scheduled release' : 'Private'}</Status></td>
          <td className="numeric"><strong>{g.availableTickets}</strong><span className="muted"> / {g.totalTickets}</span></td>
          <td className="numeric">{g.requestedTickets}<small>{g.requestCount} {g.requestCount === 1 ? 'request' : 'requests'}</small></td>
          <td><button className="work-icon-button" aria-label={`Open ${g.title}`} onClick={() => setFocusedId(g.id)}><Glyph name="chevron" size={16} /></button></td>
        </tr>)}</tbody>
      </table>{!games.length && <EmptyRows>Change the search or filters to see other events.</EmptyRows>}</div>
      {focused && <aside className="work-inspector" aria-label="Event details">
        <div className="work-inspector-heading"><span>Event details</span><button className="work-icon-button" aria-label="Close event details" onClick={() => setFocusedId(undefined)}><Glyph name="close" size={16} /></button></div>
        <h3>{focused.title}</h3><p className="muted">{dateTime(focused.gameDate)}</p>
        <Capacity gameId={focused.id} />
        <dl className="work-facts"><div><dt>Season</dt><dd>{focused.seasonLabel || 'Independent event'}</dd></div><div><dt>Status</dt><dd>{focused.status}</dd></div><div><dt>Visibility</dt><dd>{focused.released ? 'Released' : focused.release}</dd></div>{focused.releaseAt && <div><dt>Release time</dt><dd>{dateTime(focused.releaseAt)}</dd></div>}</dl>
        <div className="work-inspector-actions">
          {focused.status === 'scheduled' && <Button onClick={() => setInterestId(focused.id)}>{admin ? 'Record interest' : 'Express interest'}</Button>}
          <Button variant="secondary" onClick={() => onRequests(focused.id)}>{admin ? 'Review requests' : 'My requests'}</Button>
          {admin && <Button variant="secondary" onClick={() => setReleaseIds([focused.id])}>Change visibility</Button>}
        </div>
        <p className="work-help">Interest adds to demand. Only a coordinator allocation reduces availability.</p>
      </aside>}
    </div>
    <Modal open={creating} onClose={() => setCreating(false)} title="New private event"><InventoryForm close={() => setCreating(false)} /></Modal>
    <Modal open={Boolean(interest)} onClose={() => setInterestId(undefined)} title="Record ticket interest">{interest && <InterestForm key={interest.id} game={interest} close={() => setInterestId(undefined)} />}</Modal>
    <Modal open={releaseIds !== null} onClose={() => setReleaseIds(null)} title="Set inventory visibility" size="lg">{releaseIds && <ReleasePanel selected={releaseIds} clear={() => { setReleaseIds(null); setSelected([]); }} />}</Modal>
  </section>;
}
