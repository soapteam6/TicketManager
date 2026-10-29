import { useState } from 'react';
import { useReview } from '../context';
import { dateTime } from '../form';
import type { SchedulePreview } from '../types';
import { Button, Field, FormError, Select, TextArea, TextInput } from '../ui';
import { EmptyRows, Glyph, Status } from './parts';
import { rowSelection } from './rowSelection';
import { ScheduleFinder } from './ScheduleFinder';
import { CopyErrorButton } from '../CopyErrorButton';
import { createErrorReport, type ErrorReport } from '../errorReport';

const example = 'date,time,title,tickets,kind\n2027-01-10,03:00,Example home game,4,game\n2027-01-15,02:00,Example performance,2,event';
type Section = 'teams' | 'seasons' | 'import';

export function SetupWorkspace() {
  const { snapshot, provider, persona, run, busy } = useReview();
  const [section, setSection] = useState<Section>('teams');
  const [teamId, setTeamId] = useState('');
  const [seasonId, setSeasonId] = useState('');
  const [creating, setCreating] = useState(false);
  const [teamDraft, setTeamDraft] = useState({ name: '', tickets: '4' });
  const [seasonDraft, setSeasonDraft] = useState({ teamId: '', label: '', start: '', end: '' });
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [previewError, setPreviewError] = useState<ErrorReport | null>(null);
  const [previewIssues, setPreviewIssues] = useState<ErrorReport | null>(null);
  const [importSeason, setImportSeason] = useState('');
  const [importMode, setImportMode] = useState<'find' | 'csv'>('find');
  const team = snapshot.teams.find(t => t.id === teamId);
  const season = snapshot.seasons.find(s => s.id === seasonId);
  const selectedSeason = importSeason || snapshot.seasons[0]?.id || '';
  function changeSection(next: Section) { setSection(next); setCreating(false); }
  const sections = [
    { id: 'teams' as const, label: 'Teams', hint: 'Ticket defaults & seasons', count: snapshot.teams.length },
    { id: 'seasons' as const, label: 'Seasons', hint: 'Calendar boundaries', count: snapshot.seasons.length },
    { id: 'import' as const, label: 'AI Import', hint: 'Describe what you need', count: null },
  ];
  return <section className="work-surface work-setup">
    <div className="work-section-heading"><div><h2>Setup & import</h2><p>Configure one area at a time. Review records before saving.</p></div></div>
    <div className="work-setup-body">
      <nav className="work-setup-navigation" aria-label="Setup sections">{sections.map(item => <button type="button" key={item.id} aria-label={item.label} aria-current={section === item.id ? 'page' : undefined} onClick={() => changeSection(item.id)}><span>{item.label}{item.count !== null && <small>{item.count}</small>}</span><span>{item.hint}</span></button>)}<p>New inventory starts private. Importing a schedule never sends an announcement.</p></nav>
      {section === 'teams' && <div className={`work-setup-section ${(creating || team) ? 'has-inspector' : ''}`}>
        <div className="work-setup-register"><div className="work-subtoolbar"><h3>Team register</h3><Button onClick={() => setCreating(true)}>+ New team</Button></div><div className="work-table-scroll"><table className="work-table"><thead><tr><th>Team</th><th className="numeric">Default tickets</th><th className="numeric">Seasons</th></tr></thead><tbody>{snapshot.teams.map(t => <tr key={t.id} className={!creating && team?.id === t.id ? 'is-selected' : ''} {...rowSelection(!creating && team?.id === t.id, () => { setTeamId(t.id); setCreating(false); })}><td>{t.name}</td><td className="numeric">{t.defaultTickets}</td><td className="numeric">{snapshot.seasons.filter(s => s.teamId === t.id).length}</td></tr>)}</tbody></table>{!snapshot.teams.length && <EmptyRows>Add a team to configure sports seasons.</EmptyRows>}</div></div>
        {(creating || team) && <aside className="work-setup-editor" aria-label="Team details">{creating ? <>
          <div className="work-inspector-heading"><strong>New team</strong><button className="work-text-button" onClick={() => setCreating(false)}>Cancel</button></div>
          <form onSubmit={async e => {
            e.preventDefault();
            const previous = new Set(snapshot.teams.map(t => t.id));
            if (await run({ type: 'createTeam', name: teamDraft.name, defaultTickets: Number(teamDraft.tickets) })) {
              const added = provider.snapshot(persona).teams.find(t => !previous.has(t.id) && t.name === teamDraft.name.trim());
              if (added) setTeamId(added.id);
              setTeamDraft({ name: '', tickets: '4' }); setCreating(false);
            }
          }}><FormError /><Field label="Team name" required><TextInput name="teamName" required maxLength={200} value={teamDraft.name} onChange={e => setTeamDraft({ ...teamDraft, name: e.target.value })} /></Field><Field label="Default tickets per game" required><TextInput name="defaultTickets" type="number" min={0} max={1000} required value={teamDraft.tickets} onChange={e => setTeamDraft({ ...teamDraft, tickets: e.target.value })} /></Field><p className="work-help">This becomes the suggested capacity when adding a game. It does not change existing events.</p><Button type="submit" disabled={busy}>Save team</Button></form>
        </> : team ? <><div className="work-inspector-heading"><strong>Team details</strong><button className="work-icon-button" aria-label="Close team details" onClick={() => setTeamId('')}><Glyph name="close" size={16} /></button></div><h3>{team.name}</h3><dl className="work-facts"><div><dt>Default capacity</dt><dd>{team.defaultTickets} tickets / game</dd></div><div><dt>Seasons</dt><dd>{snapshot.seasons.filter(s => s.teamId === team.id).length}</dd></div></dl><h4 className="work-history-heading">Seasons for this team</h4><div className="work-setup-related">{snapshot.seasons.filter(s => s.teamId === team.id).map(s => <button key={s.id} onClick={() => { setSeasonId(s.id); changeSection('seasons'); }}><span>{s.label}<small>{s.startDate} to {s.endDate}</small></span><Glyph name="chevron" size={16} /></button>)}</div><Button variant="secondary" onClick={() => { setSeasonDraft({ ...seasonDraft, teamId: team.id }); changeSection('seasons'); setCreating(true); }}>Add a season</Button></> : null}</aside>}
      </div>}
      {section === 'seasons' && <div className={`work-setup-section ${(creating || season) ? 'has-inspector' : ''}`}>
        <div className="work-setup-register"><div className="work-subtoolbar"><h3>Season register</h3><Button disabled={!snapshot.teams.length} onClick={() => setCreating(true)}>+ New season</Button></div><div className="work-table-scroll"><table className="work-table"><thead><tr><th>Season</th><th>Team</th><th>Start</th><th>End</th></tr></thead><tbody>{snapshot.seasons.map(s => <tr key={s.id} className={!creating && season?.id === s.id ? 'is-selected' : ''} {...rowSelection(!creating && season?.id === s.id, () => { setSeasonId(s.id); setCreating(false); })}><td>{s.label}</td><td>{snapshot.teams.find(t => t.id === s.teamId)?.name}</td><td className="nowrap">{s.startDate}</td><td className="nowrap">{s.endDate}</td></tr>)}</tbody></table>{!snapshot.seasons.length && <EmptyRows>{snapshot.teams.length ? 'Add a season to group sports inventory.' : 'Create a team first, then add its season.'}</EmptyRows>}</div></div>
        {(creating || season) && <aside className="work-setup-editor" aria-label="Season details">{creating ? <><div className="work-inspector-heading"><strong>New season</strong><button className="work-text-button" onClick={() => setCreating(false)}>Cancel</button></div><form onSubmit={async e => {
          e.preventDefault();
          const previous = new Set(snapshot.seasons.map(s => s.id));
          if (await run({ type: 'createSeason', teamId: seasonDraft.teamId || snapshot.teams[0]?.id || '', label: seasonDraft.label, startDate: seasonDraft.start, endDate: seasonDraft.end })) {
            const added = provider.snapshot(persona).seasons.find(s => !previous.has(s.id) && s.label === seasonDraft.label.trim());
            if (added) setSeasonId(added.id);
            setSeasonDraft({ ...seasonDraft, label: '', start: '', end: '' }); setCreating(false);
          }
        }}><FormError /><Field label="Team" required><Select name="seasonTeam" required value={seasonDraft.teamId || snapshot.teams[0]?.id || ''} onChange={e => setSeasonDraft({ ...seasonDraft, teamId: e.target.value })}>{!snapshot.teams.length && <option value="">Create a team first</option>}{snapshot.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field><Field label="Season label" required><TextInput name="seasonLabel" required maxLength={200} placeholder="2027–28 season" value={seasonDraft.label} onChange={e => setSeasonDraft({ ...seasonDraft, label: e.target.value })} /></Field><Field label="Start date" required><TextInput name="seasonStart" type="date" required value={seasonDraft.start} onChange={e => setSeasonDraft({ ...seasonDraft, start: e.target.value })} /></Field><Field label="End date" required><TextInput name="seasonEnd" type="date" required min={seasonDraft.start || undefined} value={seasonDraft.end} onChange={e => setSeasonDraft({ ...seasonDraft, end: e.target.value })} /></Field><p className="work-help">Season dates are calendar dates. No timezone conversion is applied.</p><Button type="submit" disabled={busy || !snapshot.teams.length}>Save season</Button></form></> : season ? <><div className="work-inspector-heading"><strong>Season details</strong><button className="work-icon-button" aria-label="Close season details" onClick={() => setSeasonId('')}><Glyph name="close" size={16} /></button></div><h3>{season.label}</h3><p className="work-help">{snapshot.teams.find(t => t.id === season.teamId)?.name}</p><dl className="work-facts"><div><dt>Starts</dt><dd>{season.startDate}</dd></div><div><dt>Ends</dt><dd>{season.endDate}</dd></div><div><dt>Inventory</dt><dd>{snapshot.catalog.filter(g => g.seasonId === season.id).length} events</dd></div></dl><Button variant="secondary" onClick={() => { setImportSeason(season.id); changeSection('import'); }}>Import into this season</Button></> : null}</aside>}
      </div>}
      {section === 'import' && <div className="work-import-container"><div className="work-subtoolbar"><h3>Import</h3><div className="work-access-sections" role="group" aria-label="Import source"><button aria-pressed={importMode === 'find'} onClick={() => setImportMode('find')}>AI Import</button><button aria-pressed={importMode === 'csv'} onClick={() => setImportMode('csv')}>CSV import</button></div></div>
      {importMode === 'find' ? <ScheduleFinder key={importSeason} initialSeasonId={importSeason} /> : <div className="work-import-section">
        <form className="work-import-editor" onSubmit={e => {
          e.preventDefault(); setPreviewError(null); setPreviewIssues(null); setPreview(null);
          try {
            const result = provider.previewSchedule(persona, csv);
            setPreview(result);
            if (result.errors.length) setPreviewIssues(createErrorReport({ details: result.errors }, 'Validate CSV', 'Correct the CSV before importing'));
          } catch (err) { setPreviewError(createErrorReport(err, 'Preview CSV', err instanceof Error ? err.message : 'Unable to preview this CSV.')); }
        }}>
          <div className="work-subtoolbar"><h3>Import source</h3><button type="button" className="work-text-button" onClick={() => { setCsv(example); setPreview(null); setPreviewError(null); }}>Load example</button></div>
          <Field label="Sports season" required><Select name="importSeason" value={selectedSeason} onChange={e => { setImportSeason(e.target.value); setPreview(null); }} required>{!snapshot.seasons.length && <option value="">Create a season first</option>}{snapshot.seasons.map(s => <option key={s.id} value={s.id}>{snapshot.teams.find(t => t.id === s.teamId)?.name} · {s.label}</option>)}</Select></Field>
          <Field label="Schedule CSV" hint="Columns: date,time,title,tickets,kind. Times are UTC."><TextArea name="scheduleCsv" spellCheck={false} value={csv} onChange={e => { setCsv(e.target.value); setPreview(null); setPreviewError(null); }} placeholder={'date,time,title,tickets,kind\n2027-01-10,03:00,Home game,4,game'} rows={12} required /></Field>
          <p className="work-help">Use YYYY-MM-DD dates and 24-hour HH:mm times. Dated events are imported without a season. Game rows use the selected sports season.</p>
          {previewError && <div className="space-y-2"><p role="alert" className="text-sm text-rose-800">{previewError.message}</p><CopyErrorButton details={previewError.details} /></div>}
          <Button type="submit" variant="secondary" disabled={busy || !csv.trim()}>Validate & preview</Button>
        </form>
        <section className="work-import-preview" aria-label="Schedule preview"><div className="work-subtoolbar"><h3>Import preview</h3>{preview && <Status value={preview.errors.length ? 'inactive' : 'active'}>{preview.errors.length ? 'Needs correction' : 'Ready to import'}</Status>}</div>
          <div className="work-table-scroll">{!preview ? <div className="work-import-empty"><Glyph name="inventory" size={28} /><h3>Validate the schedule first</h3><p>Paste a CSV on the left. Its rows will appear here for review before any inventory is created.</p></div> : <>
            {preview.errors.length > 0 && <div className="work-import-errors" role="alert"><strong>Correct the CSV before importing</strong>{preview.errors.map((error, index) => <p key={index}>{error}</p>)}{previewIssues && <CopyErrorButton details={previewIssues.details} />}</div>}
            <table className="work-table"><thead><tr><th>Event</th><th>Date</th><th className="numeric">Tickets</th><th>Type</th><th>Visibility</th></tr></thead><tbody>{preview.rows.map((row, index) => <tr key={index}><td>{row.title}</td><td className="nowrap">{dateTime(row.gameDate)}</td><td className="numeric">{row.tickets}</td><td>{row.kind}</td><td><Status value="private" /></td></tr>)}</tbody></table>
          </>}</div>
          <div className="work-import-commit"><div><strong>{preview ? `${preview.rows.length} events · ${preview.rows.reduce((sum, row) => sum + row.tickets, 0)} tickets` : 'No inventory will be created until you import.'}</strong><p>Imported events are private. No messages are sent.</p></div><Button disabled={busy || !selectedSeason || !preview || !preview.rows.length || preview.errors.length > 0} onClick={async () => { if (await run({ type: 'importSchedule', csv, seasonId: selectedSeason })) { setPreview(null); setCsv(''); } }}>Import private inventory</Button></div>
        </section>
      </div>}
      </div>}
    </div>
  </section>;
}
