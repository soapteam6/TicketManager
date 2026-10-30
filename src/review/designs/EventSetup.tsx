import { useState } from 'react';
import { useReview } from '../context';
import { InventoryForm } from '../InventoryPanel';
import { dateTime } from '../form';
import { Button } from '../ui';
import { EmptyRows, Glyph, Search, Status } from './parts';
import { rowSelection } from './rowSelection';
import { InventoryDelete } from './InventoryDelete';

export function EventSetup({ initialSeasonId = 'all', createOnOpen = false }: { initialSeasonId?: string; createOnOpen?: boolean }) {
  const { snapshot } = useReview();
  const [query, setQuery] = useState('');
  const [seasonId, setSeasonId] = useState(initialSeasonId);
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(createOnOpen);
  const games = snapshot.catalog.filter(game => (seasonId === 'all' || (seasonId === 'other' ? !game.seasonId : game.seasonId === seasonId)) && `${game.title} ${game.teamName ?? ''} ${game.seasonLabel ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Date.parse(a.gameDate) - Date.parse(b.gameDate));
  const selected = games.find(game => game.id === selectedId);
  return <div className={`work-event-setup ${creating || selected ? 'has-editor' : ''}`}>
    <div className="work-setup-register"><div className="work-subtoolbar"><h3>Events & Games register</h3><Button onClick={() => { setCreating(true); setSelectedId(''); }}>+ New event</Button></div>
      <div className="work-toolbar"><Search value={query} onChange={setQuery} placeholder="Search event setup" /><select aria-label="Setup event season" value={seasonId} onChange={e => { setSeasonId(e.target.value); setSelectedId(''); }}><option value="all">All seasons & events</option><option value="other">Other events</option>{snapshot.seasons.map(season => <option key={season.id} value={season.id}>{snapshot.teams.find(team => team.id === season.teamId)?.name} · {season.label}</option>)}</select></div>
      <div className="work-table-scroll"><table className="work-table"><thead><tr><th>Event / season</th><th>Date</th><th>Tickets</th><th>Status</th></tr></thead><tbody>{games.map(game => <tr key={game.id} {...rowSelection(selected?.id === game.id, () => { setSelectedId(game.id); setCreating(false); })} className={selected?.id === game.id ? 'is-selected' : ''}><td><strong>{game.title}</strong><small>{game.teamName}{game.seasonLabel ? ` · ${game.seasonLabel}` : 'Other event'}</small></td><td>{dateTime(game.gameDate)}</td><td>{game.totalTickets}</td><td><Status value={game.status} /></td></tr>)}</tbody></table>{!games.length && <EmptyRows>No events match. Add an event or change the filter.</EmptyRows>}</div>
    </div>
    {(creating || selected) && <aside className="work-setup-editor work-event-editor" aria-label={creating ? 'New event' : 'Edit event'}><div className="work-inspector-heading"><strong>{creating ? 'New private event' : 'Edit event'}</strong><button type="button" className="work-icon-button" aria-label="Close event editor" onClick={() => { setCreating(false); setSelectedId(''); }}><Glyph name="close" /></button></div>
      <InventoryForm key={creating ? `new:${seasonId}` : `${selected!.id}:${selected!.gameDate}:${selected!.totalTickets}`} game={creating ? undefined : selected} defaultSeasonId={seasonId !== 'all' && seasonId !== 'other' ? seasonId : ''} close={() => { setCreating(false); setSelectedId(''); }} />
      {!creating && selected && <InventoryDelete key={selected.id} kind="game" id={selected.id} onDeleted={() => setSelectedId('')} />}
    </aside>}
  </div>;
}
