import { useEffect, useState } from 'react';
import { useReview } from '../context';
import { isCalendarDate, isoToLocalDateTimeInput, localDateTimeInputToIso, localTimeZone, timeZoneLabel } from '../dates';
import { reviewErrorMessage } from '../errorMessage';
import { createErrorReport, type ErrorReport } from '../errorReport';
import { CopyErrorButton } from '../CopyErrorButton';
import { discoveredAllocations, discoveredGameIssues, discoveredGamesCsv, parseScheduleDiscovery, type DiscoveredGame, type ScheduleDiscovery } from '../scheduleDiscovery';
import { ImportTicketReview } from './ImportTicketReview';
import type { ImportFileUpload, ScheduleSearchJob } from '../types';
import { readImportFiles } from '../importFiles';
import { Button, Field, Select, TextArea, TextInput } from '../ui';
import { EmptyRows } from './parts';

export function ScheduleFinder({ initialSeasonId = '' }: { initialSeasonId?: string }) {
  const { snapshot, provider, persona, run, busy } = useReview();
  const initialSeason = snapshot.seasons.find(s => s.id === initialSeasonId);
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<ImportFileUpload[]>([]);
  const [readingFiles, setReadingFiles] = useState(false);
  const [tickets, setTickets] = useState(initialSeason ? String(snapshot.teams.find(t => t.id === initialSeason.teamId)?.defaultTickets ?? '') : '');
  const [homeOnly, setHomeOnly] = useState(true);
  const [seasonId, setSeasonId] = useState(initialSeasonId);
  const [draft, setDraft] = useState({ teamId: '', teamName: '', label: '', startDate: '', endDate: '' });
  const [jobId, setJobId] = useState('');
  const [job, setJob] = useState<ScheduleSearchJob>();
  const [discovery, setDiscovery] = useState<ScheduleDiscovery>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<ErrorReport | null>(null);
  const searching = starting || !!jobId && (!job || ['queued', 'searching'].includes(job.status));
  const available = !!snapshot.scheduleSearchAvailable && !!provider.startScheduleSearch && !!provider.getScheduleSearch;
  const season = snapshot.seasons.find(s => s.id === seasonId);
  useEffect(() => {
    if (!jobId || !provider.getScheduleSearch) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        const result = await provider.getScheduleSearch!(persona, jobId);
        if (!active) return;
        setJob(result);
        if (result.status === 'complete') {
          const found = parseScheduleDiscovery(result.rawResult, result.request);
          const team = provider.snapshot(persona).teams.find(t => t.name.toLowerCase() === found.team.toLowerCase());
          const existing = provider.snapshot(persona).seasons.find(s => s.teamId === team?.id && s.label === found.season);
          setDiscovery(found); setQuery(result.request.query); setHomeOnly(result.request.homeOnly); setError(null);
          setSeasonId(result.request.seasonId || existing?.id || '');
          setDraft({ teamId: team?.id ?? '', teamName: found.team, label: found.season, startDate: found.seasonStart, endDate: found.seasonEnd });
          if (result.request.ticketsPerEvent > 0) setTickets(String(result.request.ticketsPerEvent));
        } else if (result.status === 'failed') setError(createErrorReport(result.error || 'AI Import could not complete. Try a more specific request.', `AI Import result: ${jobId}`));
        else if (['queued', 'searching'].includes(result.status)) timer = setTimeout(poll, 2500);
        else throw new Error('The search returned an unexpected status.');
        failures = 0;
      } catch (err) {
        if (!active) return;
        if (++failures < 3) timer = setTimeout(poll, 2500);
        else { setError(createErrorReport(err, `Check AI Import: ${jobId}`)); setJobId(''); }
      }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [jobId, provider, persona]);
  function issues(game: DiscoveredGame) {
    const list = discoveredGameIssues(game, snapshot.catalog, homeOnly);
    const start = season?.startDate || draft.startDate, end = season?.endDate || draft.endDate;
    if (game.localDate && ((start && game.localDate < start) || (end && game.localDate > end))) list.push('Outside the destination season');
    return list;
  }
  const ready = discovery?.games.filter(g => g.selected && issues(g).length === 0) ?? [];
  const defaultTicketsValid = tickets !== '' && Number.isInteger(Number(tickets)) && Number(tickets) >= 0 && Number(tickets) <= 1000;
  const ticketsValid = defaultTicketsValid || ready.length > 0 && ready.every(g => g.ticketsKnown);
  const needsSeason = ready.some(g => g.kind !== 'event');
  const targetValid = !needsSeason || !!season || !!(draft.label.trim() && (draft.teamId || draft.teamName.trim()) && isCalendarDate(draft.startDate) && isCalendarDate(draft.endDate) && draft.startDate <= draft.endDate);
  const update = (id: string, patch: Partial<DiscoveredGame>) => setDiscovery(current => current && ({ ...current, games: current.games.map(g => g.id === id ? { ...g, ...patch } : g) }));
  function updateStart(game: DiscoveredGame, input: string) {
    if (!input) { update(game.id, { startAt: '', timeIssue: 'Enter the confirmed start time' }); return; }
    try {
      const startAt = localDateTimeInputToIso(input);
      let localDate = input.slice(0, 10);
      try { localDate = isoToLocalDateTimeInput(startAt, game.timezone).slice(0, 10); } catch { /* A manual local edit can correct an unknown source timezone. */ }
      update(game.id, { startAt, timeIssue: '', localDate });
    } catch (err) { update(game.id, { startAt: '', timeIssue: reviewErrorMessage(err) }); }
  }
  return <div className={`work-import-section work-schedule-finder ${discovery ? 'has-result' : 'is-prompt'}`}>
    <form className="work-import-editor" onSubmit={async e => {
      e.preventDefault(); if (!available || !provider.startScheduleSearch || readingFiles || !query.trim() && !files.length) return;
      setStarting(true); setError(null); setJobId(''); setJob(undefined); setDiscovery(undefined);
      try {
        const result = await provider.startScheduleSearch(persona, { query: query.trim(), seasonId: initialSeasonId, ticketsPerEvent: defaultTicketsValid ? Number(tickets) : 0, homeOnly, timeZone: localTimeZone(), ...(files.length > 0 && { files }) }, crypto.randomUUID());
        setJob(result); setJobId(result.id);
      } catch (err) { setError(createErrorReport(err, 'Start AI Import')); }
      finally { setStarting(false); }
    }}>
      <div className="work-subtoolbar"><h3>What would you like to import?</h3></div>
      <Field label="Describe what you need" required={!files.length}><TextArea name="scheduleQuery" required={!files.length} maxLength={2000} rows={6} disabled={searching || busy} value={query} onChange={e => setQuery(e.target.value)} placeholder="Find next season’s VGK home games, or import the ticket tracker I’ve attached." /></Field>
      <Field label="Attach files"><input type="file" aria-label="Attach import files" multiple disabled={searching || busy || readingFiles} onChange={async e => {
        const selected = [...(e.target.files ?? [])]; e.target.value = ''; setReadingFiles(true); setError(null);
        try { setFiles(await readImportFiles(selected, files)); } catch (err) { setError(createErrorReport(err, 'Read import files')); } finally { setReadingFiles(false); }
      }} className="block w-full text-sm" /></Field>
      <p className="work-help">Type a request, attach files, or both. Excel, CSV, documents, PDFs and images can be reviewed by Claude. Up to 5 files, 4 MB total.</p>
      {(files.length > 0 || job?.request.files?.length) && <ul className="max-h-32 overflow-y-auto space-y-2 text-sm" aria-label="Attached import files">{(files.length ? files : job?.request.files ?? []).map(f => <li key={f.name} className="flex items-center justify-between gap-2"><span className="break-all">{f.name} <small>({Math.ceil(f.size / 1024)} KB)</small></span>{files.length > 0 && <button type="button" disabled={searching || busy} className="underline" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter(x => x.name !== f.name))}>Remove</button>}</li>)}</ul>}
      {initialSeason && <p className="work-help">For {snapshot.teams.find(t => t.id === initialSeason.teamId)?.name} · {initialSeason.label}</p>}
      <details className="work-ai-options"><summary>Search options</summary><label className="work-search-home"><input name="homeOnly" type="checkbox" disabled={searching || busy} checked={homeOnly} onChange={e => setHomeOnly(e.target.checked)} />Home games only</label></details>
      {!available && <p className="work-help">AI Import is unavailable. CSV import is available.</p>}
      {error && <div className="space-y-2"><p className="work-import-error-message" role="alert">{error.message}</p><CopyErrorButton details={error.details} /></div>}
      <Button type="submit" disabled={busy || searching || readingFiles || !available || !query.trim() && !files.length}>{readingFiles ? 'Reading files…' : searching ? 'Preparing import…' : 'Prepare import'}</Button>
      {searching && <p className="work-help" role="status">Preparing the import. Files can take several minutes. Keep AI Import open until your preview is ready.</p>}
    </form>
    {discovery && <section className="work-import-preview" aria-label="Found schedule"><div className="work-subtoolbar"><h3>{discovery.team || 'Import preview'}{discovery.season ? ` · ${discovery.season}` : ''}</h3><span className="work-help">{ready.length} selected · {timeZoneLabel()}</span></div>
      <div className="work-table-scroll">
        {discovery.warnings.length > 0 && <div className="work-import-errors">{discovery.warnings.map((w, i) => <p key={i}>{w}</p>)}</div>}
        <details className="work-schedule-source-disclosure"><summary>Sources ({discovery.sources.length})</summary><div className="work-schedule-sources">{discovery.sources.map(s => s.fileName ? <span key={s.fileName}>{s.title} (uploaded file)</span> : <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>)}</div></details>
        {discovery.games.length > 0 && <fieldset className="work-ai-target" disabled={busy}><legend>Import destination</legend>
          {discovery.games.some(g => g.kind !== 'event') && <Field label="Season"><Select name="searchSeason" value={seasonId} onChange={e => setSeasonId(e.target.value)}><option value="">Create a new season</option>{snapshot.seasons.map(s => <option key={s.id} value={s.id}>{snapshot.teams.find(t => t.id === s.teamId)?.name} · {s.label}</option>)}</Select></Field>}
          <Field label="Default tickets per game" required={!job?.request.files?.length}><TextInput name="searchTickets" type="number" min={0} max={1000} required={!job?.request.files?.length} value={tickets} placeholder={job?.request.files?.length ? 'Use quantities from the file' : 'Enter quantity'} onChange={e => { setTickets(e.target.value); const n = Number(e.target.value); setDiscovery(current => current && ({ ...current, games: current.games.map(g => ({ ...g, tickets: n, ticketsKnown: e.target.value !== '' })) })); }} /></Field>
          {!seasonId && discovery.games.some(g => g.kind !== 'event') && <>
            <Field label="Team"><Select name="importTeam" value={draft.teamId} onChange={e => setDraft({ ...draft, teamId: e.target.value })}><option value="">Create a new team</option>{snapshot.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            {!draft.teamId && <Field label="Team name" required><TextInput name="importTeamName" maxLength={200} required value={draft.teamName} onChange={e => setDraft({ ...draft, teamName: e.target.value })} /></Field>}
            <Field label="Season label" required><TextInput name="importSeasonLabel" maxLength={200} required value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} /></Field>
            <Field label="Season starts" required><TextInput name="importSeasonStart" type="date" required value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></Field>
            <Field label="Season ends" required><TextInput name="importSeasonEnd" type="date" min={draft.startDate || undefined} required value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} /></Field>
          </>}
        </fieldset>}
        <table className="work-table work-found-schedule"><thead><tr><th><input type="checkbox" aria-label="Select ready games" disabled={busy} checked={discovery.games.some(g => issues(g).length === 0) && discovery.games.filter(g => issues(g).length === 0).every(g => g.selected)} onChange={e => setDiscovery({ ...discovery, games: discovery.games.map(g => ({ ...g, selected: e.target.checked && issues(g).length === 0 })) })} /></th><th>Game / source</th><th>Date</th><th>Our tickets</th><th>Review</th></tr></thead><tbody>{discovery.games.map(game => {
          const errors = issues(game);
          return <tr key={game.id}><td><input type="checkbox" aria-label={`Import ${game.title}`} checked={game.selected && !errors.length} disabled={busy || !!errors.length} onChange={e => update(game.id, { selected: e.target.checked })} /></td>
            <td><TextInput aria-label={`Title for ${game.title}`} disabled={busy} value={game.title} maxLength={200} onChange={e => update(game.id, { title: e.target.value })} />{game.sourceUrl && <a className="work-source-link" href={game.sourceUrl} target="_blank" rel="noopener noreferrer">View source</a>}{game.sourceFile && <small>{game.sourceFile}{game.sourceLocation ? ` · ${game.sourceLocation}` : ''}</small>}<small>{game.venue}{game.home === false ? ' · Away' : ''}</small>{game.allocationNote && <small>{game.allocationNote}</small>}</td>
            <td><TextInput type="datetime-local" disabled={busy} aria-label={`Local start for ${game.title}`} value={isoToLocalDateTimeInput(game.startAt)} onChange={e => updateStart(game, e.target.value)} />{!game.startAt && game.localDate && <small>Source date: {game.localDate}; time TBD</small>}</td>
            <td><TextInput type="number" min={0} max={1000} disabled={busy} aria-label={`Tickets for ${game.title}`} value={game.tickets} onChange={e => update(game.id, { tickets: Number(e.target.value), ticketsKnown: e.target.value !== '' })} /></td><td>{errors.length ? errors.map(issue => <small key={issue}>{issue}</small>) : 'Ready'}<ImportTicketReview game={game} onChange={ticketRows => update(game.id, { ticketRows })} /></td></tr>;
        })}</tbody></table>{!discovery.games.length && <EmptyRows>No published games were found for this request. Check the notes above or add a team and season year to your request.</EmptyRows>}
      </div>
      {discovery.games.some(g => g.ticketRows?.some(t => !t.resolution || t.resolution !== 'available' && !t.contactId && !t.crmContact)) && <p className="work-import-errors" role="status">Games with unresolved tickets are excluded until you review their statuses and recipients.</p>}
      {discovery.games.length > 0 && <div className="work-import-commit"><div><strong>{ready.length} games · {ready.reduce((n, g) => n + g.tickets, 0)} tickets</strong><p>{!ticketsValid ? 'Enter the number of tickets you own per game.' : !needsSeason ? 'Imported events start private.' : seasonId ? 'Imported games start private.' : 'The team, season and private games will be saved together.'}</p></div><Button disabled={busy || searching || !ticketsValid || !targetValid || !ready.length || ready.length > 100} onClick={async () => {
        if (await run({ type: 'importSchedule', csv: discoveredGamesCsv(ready), seasonId, importedAllocations: discoveredAllocations(ready), ...(!seasonId && needsSeason && { newSeason: { ...draft, defaultTickets: defaultTicketsValid ? Number(tickets) : ready[0]?.tickets ?? 0 } }) })) {
          setJobId(''); setJob(undefined); setDiscovery(undefined); setError(null);
          setQuery(''); setFiles([]); setHomeOnly(true); setSeasonId(initialSeasonId);
          setTickets(initialSeason ? String(snapshot.teams.find(t => t.id === initialSeason.teamId)?.defaultTickets ?? '') : '');
          setDraft({ teamId: '', teamName: '', label: '', startDate: '', endDate: '' });
        }
      }}>{!needsSeason ? 'Import selected events' : seasonId ? 'Import selected games' : 'Create season & import'}</Button></div>}
    </section>}
  </div>;
}
