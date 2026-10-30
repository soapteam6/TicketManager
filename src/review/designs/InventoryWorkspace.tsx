import { useState } from 'react';
import { useReview } from '../context';
import { inventoryHierarchy, inventoryTotals, scopedInventory } from '../inventoryNavigation';
import { InventoryGrid } from './InventoryGrid';
import { EmptyRows, Glyph, Search, Status } from './parts';

function TicketTotals({ totals }: { totals: ReturnType<typeof inventoryTotals> }) {
  return <span className="work-inventory-metrics">
    <span><strong>{totals.tickets.toLocaleString()}</strong><span>Scheduled tickets</span></span>
    <span><strong>{totals.available.toLocaleString()}</strong><span>Available</span></span>
    <span><strong>{totals.scheduled.toLocaleString()}</strong><span>Scheduled events</span></span>
  </span>;
}

export function InventoryWorkspace({ onRequests }: { onRequests: (gameId: string) => void }) {
  const { snapshot } = useReview();
  const coordinator = snapshot.persona.role === 'coordinator';
  const [teamId, setTeamId] = useState('');
  const [seasonId, setSeasonId] = useState('');
  const [independent, setIndependent] = useState(false);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const hierarchy = inventoryHierarchy(snapshot);
  const team = hierarchy.teams.find(item => item.id === teamId && (showInactive || item.active));
  const season = hierarchy.seasons.find(item => item.id === seasonId && item.teamId === team?.id && (showInactive || item.active));
  function showTeams() { setTeamId(''); setSeasonId(''); setIndependent(false); setQuery(''); }
  function showTeam(id: string) { setTeamId(id); setSeasonId(''); setIndependent(false); setQuery(''); }
  const navigation = <nav className="work-inventory-navigation" aria-label="Inventory navigation">
    <button type="button" onClick={showTeams}>Teams</button>
    {team && <><Glyph name="chevron" size={12} /><button type="button" onClick={() => showTeam(team.id)}>{team.name}</button></>}
  </nav>;
  if (independent || season) return <InventoryGrid key={independent ? 'independent' : season!.id}
    scope={independent ? { kind: 'independent' } : { kind: 'season', seasonId: season!.id }}
    title={independent ? 'Other events' : season!.label} subtitle={independent ? 'Dated events without a sports season.' : team!.name}
    navigation={navigation} onRequests={onRequests} />;

  const visibleTeams = hierarchy.teams.filter(item => (showInactive || item.active) && item.name.toLowerCase().includes(query.toLowerCase()));
  const visibleSeasons = hierarchy.seasons.filter(item => (showInactive || item.active) && item.teamId === team?.id && item.label.toLowerCase().includes(query.toLowerCase()));
  const otherGames = scopedInventory(snapshot.catalog, { kind: 'independent' });
  return <section className="work-surface work-inventory-dashboard" aria-label={team ? 'Season dashboard' : 'Team dashboard'}>
    {team && navigation}
    <div className="work-section-heading"><div><h2>{team ? team.name : 'Events & Games inventory'}</h2><p>{team ? 'Season inventory' : 'Teams & other events'}</p></div></div>
    <div className="work-toolbar"><Search value={query} onChange={setQuery} placeholder={team ? 'Search seasons' : 'Search teams'} />
      <label className="work-inactive-toggle"><input type="checkbox" aria-label="Show inactive teams and seasons" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />Show inactive</label>
      <span className="work-toolbar-count">{team ? `${visibleSeasons.length} ${visibleSeasons.length === 1 ? 'season' : 'seasons'}` : `${visibleTeams.length} ${visibleTeams.length === 1 ? 'team' : 'teams'}`}</span></div>
    <div className="work-dashboard-scroll">
      <ul className="work-inventory-cards">
        {team ? visibleSeasons.map(item => {
          const totals = inventoryTotals(scopedInventory(snapshot.catalog, { kind: 'season', seasonId: item.id }));
          return <li key={item.id}><button type="button" className="work-inventory-card" aria-label={`View events for ${item.label}`} onClick={() => { setSeasonId(item.id); setQuery(''); }}>
            <span className="work-inventory-card-title"><strong>{item.label}</strong><Glyph name="chevron" /></span>
            {item.active === false && <span><Status value="inactive" /></span>}
            {(item.startDate || item.endDate) && <span className="work-inventory-card-description">{item.startDate} – {item.endDate}</span>}
            <TicketTotals totals={totals} />
            {totals.historical > 0 && <span className="work-inventory-card-description">{totals.historical} historical {totals.historical === 1 ? 'event' : 'events'}</span>}
          </button></li>;
        }) : <>
          {visibleTeams.map(item => {
            const seasons = hierarchy.seasons.filter(entry => entry.teamId === item.id && (showInactive || entry.active));
            const ids = new Set(seasons.map(entry => entry.id));
            const totals = inventoryTotals(snapshot.catalog.filter(game => game.seasonId && ids.has(game.seasonId)));
            return <li key={item.id}><button type="button" className="work-inventory-card" aria-label={`View seasons for ${item.name}`} onClick={() => showTeam(item.id)}>
              <span className="work-inventory-card-title"><strong>{item.name}</strong><Glyph name="chevron" /></span>
              {item.active === false && <span><Status value="inactive" /></span>}
              <span className="work-inventory-card-description">{seasons.length} {seasons.length === 1 ? 'season' : 'seasons'}</span><TicketTotals totals={totals} />
            </button></li>;
          })}
          {(coordinator || otherGames.length > 0) && 'other events'.includes(query.toLowerCase()) && <li><button type="button" className="work-inventory-card work-inventory-card--other" aria-label="View other events" onClick={() => { setIndependent(true); setQuery(''); }}>
            <span className="work-inventory-card-title"><strong>Other events</strong><Glyph name="chevron" /></span>
            <span className="work-inventory-card-description">Concerts & dated events without a season</span><TicketTotals totals={inventoryTotals(otherGames)} />
          </button></li>}
        </>}
      </ul>
      {team && !visibleSeasons.length && <EmptyRows>{query ? 'No seasons match your search.' : coordinator ? 'Create a season in Setup & import to add games for this team.' : 'No seasons with released events are available.'}</EmptyRows>}
      {!team && !visibleTeams.length && !(('other events'.includes(query.toLowerCase())) && (coordinator || otherGames.length)) && <EmptyRows>{query ? 'No teams match your search.' : 'No released events are available yet.'}</EmptyRows>}
    </div>
  </section>;
}
