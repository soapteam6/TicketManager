import { useState, type FormEvent, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Season, Team } from '@/lib/types';
import { pickArray, pickObject } from '@/lib/unwrap';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState, ErrorNote } from '@/components/QueryState';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Field, TextInput, TextArea } from '@/components/Field';
import { RoleGate } from '@/auth/AuthContext';
import { EmptyState } from '@/components/EmptyState';
import { Spinner } from '@/components/Spinner';
import { formatDateTime } from '@/lib/format';
import type { ExtractedGame } from '@ais/shared';

export function TeamsPage() {
  const [selected, setSelected] = useState<Team | null>(null);
  const [showNewTeam, setShowNewTeam] = useState(false);

  const teams = useQuery({
    queryKey: ['teams'],
    queryFn: async () => pickArray<Team>((await api.get('/teams')).data, 'teams'),
  });

  const columns: Column<Team>[] = [
    {
      key: 'name',
      header: 'Team',
      render: (t) => (
        <div>
          <div className="font-medium text-slate-900">{t.name}</div>
          <div className="text-xs text-slate-400">{t.sport ?? '—'}</div>
        </div>
      ),
    },
    { key: 'abbr', header: 'Abbr', render: (t) => <Badge tone="slate">{t.abbreviation}</Badge> },
    { key: 'venue', header: 'Venue', render: (t) => t.venue ?? '—' },
    { key: 'platform', header: 'Platform', render: (t) => <span className="capitalize">{t.defaultPlatform}</span> },
    { key: 'games', header: 'Home games', align: 'right', render: (t) => t.homeGamesPerSeason },
    {
      key: 'active',
      header: 'Status',
      render: (t) => <Badge status={t.isActive ? 'active' : 'archived'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Teams & Seasons"
        subtitle="Season-ticket holdings across all AIS teams."
        actions={
          <RoleGate roles={['admin']}>
            <Button onClick={() => setShowNewTeam(true)}>New team</Button>
          </RoleGate>
        }
      />

      <QueryState isLoading={teams.isLoading} error={teams.error}>
        <DataTable
          columns={columns}
          rows={teams.data}
          keyFn={(t) => t.id}
          onRowClick={(t) => setSelected(t)}
          emptyTitle="No teams"
          emptyDescription="Teams are seeded on setup."
        />
      </QueryState>

      {selected && <TeamDrawer team={selected} onClose={() => setSelected(null)} />}
      {showNewTeam && <NewTeamModal onClose={() => setShowNewTeam(false)} onCreated={(t) => { setShowNewTeam(false); setSelected(t); }} />}
    </div>
  );
}

// Add a team with its details typed in. The official website is used later to pull the schedule.
function NewTeamModal({ onClose, onCreated }: { onClose: () => void; onCreated: (team: Team) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [abbreviation, setAbbreviation] = useState('');
  const [sport, setSport] = useState('');
  const [venue, setVenue] = useState('');
  const [officialUrl, setOfficialUrl] = useState('');
  const [tickets, setTickets] = useState('0');

  const create = useMutation({
    mutationFn: async () =>
      pickObject<Team>(
        (
          await api.post('/teams', {
            name,
            abbreviation: abbreviation || undefined,
            sport: sport || undefined,
            venue: venue || undefined,
            officialUrl: officialUrl || '',
            defaultTicketsPerGame: Number(tickets) || 0,
          })
        ).data,
        'team'
      ),
    onSuccess: (team) => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      if (team) onCreated(team);
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="New team"
      description="Enter the team's details. The official website is used later to pull its schedule."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={!name} onClick={() => create.mutate()}>Add team</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Team name" required>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Vegas Golden Knights" required />
          </Field>
          <Field label="Abbreviation" hint="Optional">
            <TextInput value={abbreviation} onChange={(e) => setAbbreviation(e.target.value)} placeholder="VGK" />
          </Field>
          <Field label="Sport / league" hint="Optional">
            <TextInput value={sport} onChange={(e) => setSport(e.target.value)} placeholder="NHL Hockey" />
          </Field>
          <Field label="Venue" hint="Optional">
            <TextInput value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="T-Mobile Arena" />
          </Field>
        </div>
        <Field label="Official website" hint="Used later to pull the schedule (Import schedule with AI)">
          <TextInput value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} placeholder="https://www.vegasgoldenknights.com/schedule/" />
        </Field>
        <Field label="Default tickets / game" hint="Seats auto-created on schedule import">
          <TextInput type="number" min="0" value={tickets} onChange={(e) => setTickets(e.target.value)} />
        </Field>
        <ErrorNote error={create.error} />
      </div>
    </Modal>
  );
}

function TeamDrawer({ team, onClose }: { team: Team; onClose: () => void }) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const [showAddGame, setShowAddGame] = useState(false);

  const detail = useQuery({
    queryKey: ['teams', team.id],
    queryFn: async () => {
      const data = (await api.get(`/teams/${team.id}`)).data;
      return {
        team: pickObject<Team>(data, 'team') ?? team,
        seasons: pickArray<Season>(data, 'seasons'),
      };
    },
  });
  const currentTeam = detail.data?.team ?? team;

  const activate = useMutation({
    mutationFn: async (seasonId: number) => (await api.post(`/seasons/${seasonId}/activate`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams', team.id] });
      qc.invalidateQueries({ queryKey: ['dashboards', 'overview'] });
    },
  });

  return (
    <Modal open onClose={onClose} title={team.name} description={`${team.sport ?? ''} · ${team.venue ?? ''}`} size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <RoleGate roles={['admin']}>
        <TeamSettings team={currentTeam} onDeleted={onClose} />
      </RoleGate>

      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">Seasons</h3>
        <div className="flex flex-wrap items-center gap-2">
          <RoleGate roles={['admin']}>
            <Button size="sm" variant="secondary" onClick={() => setShowCsv(true)}>Import CSV</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowImport(true)}>Import (paste)</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowAddGame(true)}>Add game</Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>New season</Button>
          </RoleGate>
        </div>
      </div>

      <QueryState isLoading={detail.isLoading} error={detail.error}>
        {detail.data && detail.data.seasons.length > 0 ? (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {detail.data.seasons.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <Link to={`/seasons/${s.id}`} className="font-medium text-brand-700 hover:underline" onClick={onClose}>
                    {s.label}
                  </Link>
                  <div className="text-xs text-slate-400">
                    {formatDate(s.startDate)} – {formatDate(s.endDate)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge status={s.status} />
                  {s.status !== 'active' && (
                    <RoleGate roles={['admin']}>
                      <Button size="sm" variant="secondary" loading={activate.isPending && activate.variables === s.id} onClick={() => activate.mutate(s.id)}>
                        Activate
                      </Button>
                    </RoleGate>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No seasons yet" description="Create a season to start scheduling games." />
        )}
      </QueryState>

      <ErrorNote error={activate.error} />

      {showCreate && (
        <CreateSeasonModal
          teamId={team.id}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['teams', team.id] });
          }}
        />
      )}

      {showImport && (
        <ScheduleImportModal
          team={currentTeam}
          onClose={() => setShowImport(false)}
          onImported={() => {
            qc.invalidateQueries({ queryKey: ['teams', team.id] });
            qc.invalidateQueries({ queryKey: ['games'] });
          }}
        />
      )}
      {showAddGame && (
        <AddGameModal
          team={currentTeam}
          onClose={() => setShowAddGame(false)}
          onAdded={() => {
            qc.invalidateQueries({ queryKey: ['teams', team.id] });
            qc.invalidateQueries({ queryKey: ['games'] });
          }}
        />
      )}
      {showCsv && (
        <CSVImportModal
          team={currentTeam}
          onClose={() => setShowCsv(false)}
          onImported={() => {
            qc.invalidateQueries({ queryKey: ['teams', team.id] });
            qc.invalidateQueries({ queryKey: ['games'] });
          }}
        />
      )}
    </Modal>
  );
}

// Download a per-team CSV template, fill it in a spreadsheet, and upload it to import the schedule.
function CSVImportModal({ team, onClose, onImported }: { team: Team; onClose: () => void; onImported: () => void }) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [dlLoading, setDlLoading] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; seatsCreated: number; seasonLabel?: string; errors?: string[] } | null>(null);

  async function downloadTemplate() {
    setDlLoading(true);
    try {
      const res = await api.get(`/teams/${team.id}/schedule/template.csv`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(team.abbreviation || team.name || 'team').toLowerCase()}-schedule-template.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDlLoading(false);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setCsvText(await f.text());
    setResult(null);
  }

  const importCsv = useMutation({
    mutationFn: async () =>
      (await api.post(`/teams/${team.id}/schedule/import-csv`, { csv: csvText })).data as {
        imported: number;
        skipped: number;
        seatsCreated: number;
        seasonLabel?: string;
        errors?: string[];
      },
    onSuccess: (data) => {
      setResult(data);
      onImported();
    },
  });

  const rowCount = csvText ? csvText.split(/\r?\n/).filter((l) => l.trim()).length : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="Import schedule from CSV"
      description="Download the template, fill in the games in a spreadsheet, then upload it."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button loading={importCsv.isPending} disabled={!csvText || !!result} onClick={() => importCsv.mutate()}>Import CSV</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 text-sm font-medium text-slate-700">1. Download the template</div>
          <p className="mb-3 text-xs text-slate-500">
            Columns: <span className="font-mono">date, time, opponent, promotions, tickets</span> — the tickets column is
            pre-filled with this team's default ({team.defaultTicketsPerGame ?? 0}).
          </p>
          <Button variant="secondary" size="sm" loading={dlLoading} onClick={downloadTemplate}>Download CSV template</Button>
        </div>

        <div className="rounded-lg border border-slate-200 p-4">
          <div className="mb-2 text-sm font-medium text-slate-700">2. Upload your filled CSV</div>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
          />
          {fileName && <p className="mt-2 text-xs text-slate-500">Loaded {fileName} — {Math.max(0, rowCount - 1)} data rows.</p>}
        </div>

        {result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Imported {result.imported} games{result.seasonLabel ? ` into ${result.seasonLabel}` : ''} ({result.skipped} skipped as duplicates), created {result.seatsCreated} seats.
            {result.errors && result.errors.length > 0 && (
              <div className="mt-1 text-xs text-amber-700">{result.errors.length} row(s) skipped: {result.errors.slice(0, 3).join('; ')}{result.errors.length > 3 ? '…' : ''}</div>
            )}
          </div>
        )}
        <ErrorNote error={importCsv.error} />
      </div>
    </Modal>
  );
}

// Manually add a single game to a team (season auto-created if needed).
function AddGameModal({ team, onClose, onAdded }: { team: Team; onClose: () => void; onAdded: () => void }) {
  const [gameDate, setGameDate] = useState('');
  const [opponent, setOpponent] = useState('');
  const [promotions, setPromotions] = useState('');
  const [tickets, setTickets] = useState(String(team.defaultTicketsPerGame ?? 0));

  const add = useMutation({
    mutationFn: async () =>
      (await api.post(`/teams/${team.id}/games`, { gameDate, opponent, promotions: promotions || undefined, tickets: Number(tickets) || 0 })).data,
    onSuccess: () => {
      onAdded();
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Add game"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={add.isPending} disabled={!gameDate || !opponent} onClick={() => add.mutate()}>Add game</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date &amp; start time" required>
            <TextInput type="datetime-local" value={gameDate} onChange={(e) => setGameDate(e.target.value)} required />
          </Field>
          <Field label="Tickets available" hint="Seats to create">
            <TextInput type="number" min="0" value={tickets} onChange={(e) => setTickets(e.target.value)} />
          </Field>
        </div>
        <Field label="Opponent" required>
          <TextInput value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="e.g. Colorado Avalanche" required />
        </Field>
        <Field label="Promotions" hint="Optional">
          <TextInput value={promotions} onChange={(e) => setPromotions(e.target.value)} placeholder="e.g. Giveaway Night" />
        </Field>
        <ErrorNote error={add.error} />
      </div>
    </Modal>
  );
}

// Editable team settings: identity, official website (AI import), default tickets, and delete.
function TeamSettings({ team, onDeleted }: { team: Team; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(team.name);
  const [abbreviation, setAbbreviation] = useState(team.abbreviation);
  const [sport, setSport] = useState(team.sport ?? '');
  const [venue, setVenue] = useState(team.venue ?? '');
  const [officialUrl, setOfficialUrl] = useState(team.officialUrl ?? '');
  const [tickets, setTickets] = useState(String(team.defaultTicketsPerGame ?? 0));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/teams/${team.id}`, {
          name,
          abbreviation,
          sport,
          venue,
          officialUrl: officialUrl || '',
          defaultTicketsPerGame: Number(tickets) || 0,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['teams', team.id] });
    },
  });

  const remove = useMutation({
    mutationFn: async () => (await api.delete(`/teams/${team.id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      onDeleted();
    },
  });

  return (
    <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Team settings</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Abbreviation">
          <TextInput value={abbreviation} onChange={(e) => setAbbreviation(e.target.value)} />
        </Field>
        <Field label="Sport / league">
          <TextInput value={sport} onChange={(e) => setSport(e.target.value)} />
        </Field>
        <Field label="Venue">
          <TextInput value={venue} onChange={(e) => setVenue(e.target.value)} />
        </Field>
        <Field label="Official website" hint="Used by the AI schedule import">
          <TextInput value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} placeholder="https://www.team.com/schedule" />
        </Field>
        <Field label="Default tickets / game" hint="Seats auto-created on import">
          <TextInput type="number" min="0" value={tickets} onChange={(e) => setTickets(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button>
        {save.isSuccess && <span className="text-xs text-emerald-700">Saved</span>}
        <div className="ml-auto flex items-center gap-2">
          {confirmDelete ? (
            <>
              <span className="text-xs text-rose-700">Delete team and all its data?</span>
              <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Confirm delete</Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </>
          ) : (
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>Delete team</Button>
          )}
        </div>
      </div>
      <ErrorNote error={save.error || remove.error} />
    </div>
  );
}

// AI schedule import: browse the official site, preview extracted home games, then import.
function ScheduleImportModal({
  team,
  onClose,
  onImported,
}: {
  team: Team;
  onClose: () => void;
  onImported: () => void;
}) {
  const [pastedText, setPastedText] = useState('');
  const [ticketMode, setTicketMode] = useState<'per_game' | 'total'>('per_game');
  const [perGame, setPerGame] = useState(String(team.defaultTicketsPerGame ?? 0));
  const [totalTickets, setTotalTickets] = useState('');
  const [games, setGames] = useState<ExtractedGame[] | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; seatsCreated: number; seasonLabel?: string } | null>(null);

  const preview = useMutation({
    mutationFn: async () =>
      (await api.post(`/teams/${team.id}/schedule/import`, { pastedText, preview: true })).data as { games: ExtractedGame[]; sourceUrl: string },
    onSuccess: (data) => setGames(data.games),
  });

  const doImport = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/teams/${team.id}/schedule/import`, {
          preview: false,
          ...(ticketMode === 'total' ? { totalTickets: Number(totalTickets) || 0 } : { ticketsPerGame: Number(perGame) || 0 }),
          games,
        })
      ).data as { imported: number; skipped: number; seatsCreated: number; seasonLabel?: string },
    onSuccess: (data) => {
      setResult(data);
      onImported();
    },
  });

  const gameCount = games?.length ?? 0;
  const spreadPerGame = ticketMode === 'total' && gameCount > 0 ? Math.floor((Number(totalTickets) || 0) / gameCount) : null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Import schedule"
      description={`Paste ${team.name}'s home schedule from its official site — it's turned into games in seconds.`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {!games ? (
            <Button loading={preview.isPending} disabled={!pastedText.trim()} onClick={() => preview.mutate()}>
              Parse schedule
            </Button>
          ) : (
            <Button loading={doImport.isPending} disabled={!!result} onClick={() => doImport.mutate()}>
              Import {games.length} games
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Paste the schedule" hint="Copy the schedule off the team's official site and paste it here">
          <TextArea
            rows={8}
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            className="font-mono text-xs"
            placeholder={'Fri Oct 10  7:00 PM  vs Colorado Avalanche  (Home Opener)\nSat Oct 18  7:00 PM  vs Calgary Flames\n…'}
          />
        </Field>
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex gap-1 text-sm">
            <button
              type="button"
              onClick={() => setTicketMode('per_game')}
              className={`rounded-md px-3 py-1.5 font-medium ${ticketMode === 'per_game' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              Tickets per game
            </button>
            <button
              type="button"
              onClick={() => setTicketMode('total')}
              className={`rounded-md px-3 py-1.5 font-medium ${ticketMode === 'total' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              Total (spread evenly)
            </button>
          </div>
          {ticketMode === 'per_game' ? (
            <Field label="Tickets per game" hint="Seats auto-created for every game">
              <TextInput type="number" min="0" value={perGame} onChange={(e) => setPerGame(e.target.value)} />
            </Field>
          ) : (
            <Field
              label="Total tickets for the season"
              hint={gameCount > 0 ? `≈ ${spreadPerGame} per game across ${gameCount} games (remainder goes to the earliest games)` : 'Spread evenly once the schedule is fetched'}
            >
              <TextInput type="number" min="0" value={totalTickets} onChange={(e) => setTotalTickets(e.target.value)} placeholder="e.g. 800" />
            </Field>
          )}
        </div>

        {preview.isPending && (
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4">
            <Spinner size="sm" />
            <span className="text-sm text-slate-600">Parsing the schedule…</span>
          </div>
        )}
        <ErrorNote error={preview.error} />

        {games && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {games.length} home games found
            </div>
            <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {games.map((g, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-slate-500">{formatDateTime(g.gameDate)}</td>
                      <td className="px-3 py-1.5 font-medium text-slate-800">vs {g.opponent}</td>
                      <td className="px-3 py-1.5 text-xs text-slate-400">{g.promotions ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Imported {result.imported} games{result.seasonLabel ? ` into ${result.seasonLabel}` : ''} ({result.skipped} skipped as duplicates), created {result.seatsCreated} seats.
          </div>
        )}
        <ErrorNote error={doImport.error} />
      </div>
    </Modal>
  );
}

function CreateSeasonModal({
  teamId,
  onClose,
  onCreated,
}: {
  teamId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [label, setLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const create = useMutation({
    mutationFn: async () =>
      (await api.post('/seasons', { teamId, label, startDate, endDate })).data,
    onSuccess: onCreated,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New season"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="create-season" loading={create.isPending}>Create</Button>
        </>
      }
    >
      <form id="create-season" onSubmit={onSubmit} className="space-y-4">
        <Field label="Label" required>
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="2025-26 Regular Season" required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date" required>
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </Field>
          <Field label="End date" required>
            <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          </Field>
        </div>
        <ErrorNote error={create.error} />
      </form>
    </Modal>
  );
}
