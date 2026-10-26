import { useEffect, useState } from 'react';
import { useReview } from '../context';
import { reviewErrorMessage } from '../errorMessage';
import { discoveredGameIssues, discoveredGamesCsv, parseScheduleDiscovery, type DiscoveredGame, type ScheduleDiscovery } from '../scheduleDiscovery';
import type { ScheduleSearchJob } from '../types';
import { Button, Field, Select, TextInput } from '../ui';
import { EmptyRows, Glyph } from './parts';

export function ScheduleFinder({ seasonId, onSeason }: { seasonId: string; onSeason: (id: string) => void }) {
  const { snapshot, provider, persona, run, busy } = useReview();
  const season = snapshot.seasons.find(s => s.id === seasonId);
  const team = snapshot.teams.find(t => t.id === season?.teamId);
  const storageKey = `ticket-schedule-search:${snapshot.persona.id}:${seasonId}`;
  const storedId = () => { try { return sessionStorage.getItem(storageKey) ?? ''; } catch { return ''; } };
  const [query, setQuery] = useState('');
  const [tickets, setTickets] = useState(team?.defaultTickets ?? 4);
  const [homeOnly, setHomeOnly] = useState(true);
  const [jobId, setJobId] = useState(storedId);
  const [job, setJob] = useState<ScheduleSearchJob>();
  const [discovery, setDiscovery] = useState<ScheduleDiscovery>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const searching = starting || !!jobId && (!job || ['queued', 'searching'].includes(job.status));
  const available = !!snapshot.scheduleSearchAvailable && !!provider.startScheduleSearch && !!provider.getScheduleSearch;
  useEffect(() => {
    if (!jobId || !provider.getScheduleSearch) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        const result = await provider.getScheduleSearch!(persona, jobId);
        if (!active) return;
        if (result.request.seasonId !== seasonId) throw new Error('This search belongs to another season.');
        failures = 0; setJob(result);
        if (result.status === 'complete') {
          setDiscovery(parseScheduleDiscovery(result.rawResult, result.request));
          setQuery(result.request.query); setHomeOnly(result.request.homeOnly); setError('');
        } else if (result.status === 'failed') setError(result.error || 'Schedule search could not complete. Try a narrower query.');
        else if (['queued', 'searching'].includes(result.status)) timer = setTimeout(poll, 2500);
        else throw new Error('The search returned an unexpected status.');
      } catch (err) {
        if (!active) return;
        if (++failures < 3) timer = setTimeout(poll, 2500);
        else { setError(reviewErrorMessage(err)); setJobId(''); }
      }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [jobId, provider, persona, seasonId]);
  function issues(game: DiscoveredGame) {
    const list = discoveredGameIssues(game, snapshot.catalog, homeOnly);
    if (season && game.localDate && (game.localDate < season.startDate || game.localDate > season.endDate)) list.push('Outside the selected season');
    return list;
  }
  const ready = discovery?.games.filter(g => g.selected && issues(g).length === 0) ?? [];
  const update = (id: string, patch: Partial<DiscoveredGame>) => setDiscovery(current => current && ({ ...current, games: current.games.map(g => g.id === id ? { ...g, ...patch } : g) }));
  return <div className="work-import-section work-schedule-finder">
    <form className="work-import-editor" onSubmit={async e => {
      e.preventDefault(); if (!available || !provider.startScheduleSearch) return;
      setStarting(true); setError(''); setJobId(''); setJob(undefined); setDiscovery(undefined);
      const id = crypto.randomUUID();
      try {
        const result = await provider.startScheduleSearch(persona, { query: query.trim(), seasonId, ticketsPerEvent: tickets, homeOnly }, id);
        try { sessionStorage.setItem(storageKey, result.id); } catch { /* Search still works without browser storage. */ }
        setJob(result); setJobId(result.id);
      } catch (err) { setError(reviewErrorMessage(err)); }
      finally { setStarting(false); }
    }}>
      <div className="work-subtoolbar"><h3>Find a schedule</h3></div>
      <Field label="Sports season" required><Select name="searchSeason" required value={seasonId} onChange={e => onSeason(e.target.value)}>{!snapshot.seasons.length && <option value="">Create a season first</option>}{snapshot.seasons.map(s => <option key={s.id} value={s.id}>{snapshot.teams.find(t => t.id === s.teamId)?.name} · {s.label}</option>)}</Select></Field>
      <Field label="Find schedule for" required><TextInput name="scheduleQuery" required maxLength={300} value={query} onChange={e => setQuery(e.target.value)} placeholder="Las Vegas Aviators 2027 home games" /></Field>
      <Field label="Our tickets per game" required><TextInput name="searchTickets" type="number" min={0} max={1000} required value={tickets} onChange={e => setTickets(Number(e.target.value))} /></Field>
      <label className="work-search-home"><input name="homeOnly" type="checkbox" checked={homeOnly} onChange={e => setHomeOnly(e.target.checked)} />Home games only</label>
      <p className="work-help">Search official schedules, review the dates and sources, then import the games you want. Unconfirmed times stay out of the import.</p>
      {!available && <p className="work-help">Web schedule search is being configured. CSV import is available.</p>}
      {error && <p className="work-import-error-message" role="alert">{error}</p>}
      <Button type="submit" disabled={busy || searching || !available || !season || !query.trim()}>{searching ? 'Finding schedule…' : 'Find schedule'}</Button>
      {searching && <p className="work-help" role="status">Checking schedule sources. You can leave this screen and return while the search runs.</p>}
    </form>
    <section className="work-import-preview" aria-label="Found schedule"><div className="work-subtoolbar"><h3>{discovery ? `${discovery.team || 'Schedule'}${discovery.season ? ` · ${discovery.season}` : ''}` : 'Schedule preview'}</h3>{discovery && <span className="work-help">{ready.length} selected</span>}</div>
      <div className="work-table-scroll">{!discovery ? <div className="work-import-empty"><Glyph name={searching ? 'search' : 'inventory'} size={28} /><h3>{searching ? 'Searching the web…' : 'Find your team’s schedule'}</h3><p>{searching ? 'Results will appear here with their sources. No inventory is being created.' : 'Enter a team and year. Review and adjust the results here before importing.'}</p></div> : <>
        {discovery.warnings.length > 0 && <div className="work-import-errors">{discovery.warnings.map((w, i) => <p key={i}>{w}</p>)}</div>}
        <details className="work-schedule-source-disclosure"><summary>Sources ({discovery.sources.length})</summary><div className="work-schedule-sources">{discovery.sources.map(s => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>)}</div></details>
        <table className="work-table work-found-schedule"><thead><tr><th><input type="checkbox" aria-label="Select ready games" checked={discovery.games.some(g => issues(g).length === 0) && discovery.games.filter(g => issues(g).length === 0).every(g => g.selected)} onChange={e => setDiscovery({ ...discovery, games: discovery.games.map(g => ({ ...g, selected: e.target.checked && issues(g).length === 0 })) })} /></th><th>Game / source</th><th>Date</th><th>Our tickets</th><th>Review</th></tr></thead><tbody>{discovery.games.map(game => {
          const errors = issues(game);
          return <tr key={game.id}><td><input type="checkbox" aria-label={`Import ${game.title}`} checked={game.selected && !errors.length} disabled={!!errors.length} onChange={e => update(game.id, { selected: e.target.checked })} /></td>
            <td><TextInput aria-label={`Title for ${game.title}`} value={game.title} maxLength={200} onChange={e => update(game.id, { title: e.target.value })} />{game.sourceUrl && <a className="work-source-link" href={game.sourceUrl} target="_blank" rel="noopener noreferrer">View source</a>}<small>{game.venue}{game.home === false ? ' · Away' : ''}</small></td>
            <td><TextInput type="datetime-local" aria-label={`UTC start for ${game.title}`} value={game.startAt.slice(0, 16)} onChange={e => update(game.id, { startAt: e.target.value ? `${e.target.value}:00Z` : '', timeIssue: '', localDate: e.target.value.slice(0, 10) })} />{!game.startAt && game.localDate && <small>Source date: {game.localDate}; time TBD</small>}</td>
            <td><TextInput type="number" min={0} max={1000} aria-label={`Tickets for ${game.title}`} value={game.tickets} onChange={e => update(game.id, { tickets: Number(e.target.value) })} /></td><td>{errors.length ? errors.map(issue => <small key={issue}>{issue}</small>) : 'Ready'}</td></tr>;
        })}</tbody></table>{!discovery.games.length && <EmptyRows>No games were found for this query. Check the sources or try another year/date range.</EmptyRows>}
      </>}</div>
      <div className="work-import-commit"><div><strong>{ready.length} games · {ready.reduce((n, g) => n + g.tickets, 0)} tickets</strong><p>Imported games are private. Up to 100 games per import.</p></div><Button disabled={busy || searching || !ready.length || ready.length > 100} onClick={async () => {
        if (await run({ type: 'importSchedule', csv: discoveredGamesCsv(ready), seasonId })) {
          setDiscovery(current => current && ({ ...current, games: current.games.map(g => ({ ...g, selected: false })) }));
        }
      }}>Import selected games</Button></div>
    </section>
  </div>;
}
