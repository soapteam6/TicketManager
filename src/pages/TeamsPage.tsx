import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Cr9cd_teamsService } from '../generated/services/Cr9cd_teamsService';
import { Cr9cd_seasonsService } from '../generated/services/Cr9cd_seasonsService';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import type { Cr9cd_teams } from '../generated/models/Cr9cd_teamsModel';
import type { Cr9cd_seasons } from '../generated/models/Cr9cd_seasonsModel';
import type { Cr9cd_games } from '../generated/models/Cr9cd_gamesModel';
import { bindRef } from '../dataverse/bind';
import { seasonStatusChoice, gameStatusChoice, gameKindChoice, seatStatusChoice } from '../dataverse/choiceMaps';
import { exportSeasonTracker } from '../services/exportService';
import { exportScheduleTemplate, importScheduleTemplate } from '../services/scheduleTemplateService';
import { extractScheduleFromText, type ExtractedGame } from '../services/aiScheduleImportService';
import { countSeasonDependents, deleteSeason } from '../services/seasonsService';
import { countTeamDependents, deleteTeam } from '../services/teamsService';
import { dateOnlyToIso, isoToDateOnlyInput, formatDateOnly, formatDateTime } from '../lib/format';
import type { GameKind, SeasonStatus } from '../domain/enums';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { TextInput, Select, Field, TextArea } from '../components/Field';
import { Spinner } from '../components/Spinner';
import { Modal } from '../components/Modal';
import NotifyAvailabilityModal from '../components/NotifyAvailabilityModal';
import { useAuth } from '../auth/AuthContext';

function ExportButton({ seasonId }: { seasonId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={busy}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await exportSeasonTracker(seasonId);
        } finally {
          setBusy(false);
        }
      }}
    >
      Export .xlsx
    </Button>
  );
}

function ScheduleTemplateButtons({ seasonId, onImported }: { seasonId: string; onImported: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fileInputId = `schedule-import-${seasonId}`;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await importScheduleTemplate(seasonId, file);
      setMessage(
        `Imported: ${result.created} created, ${result.updated} updated` +
          (result.errors.length ? `, ${result.errors.length} skipped (${result.errors.join('; ')})` : '.')
      );
      onImported();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        loading={busy}
        onClick={() => exportScheduleTemplate(seasonId)}
      >
        Download template
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => document.getElementById(fileInputId)?.click()}>
        Import schedule
      </Button>
      <input
        id={fileInputId}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          handleFile(file);
        }}
      />
      {message && <span className="text-xs text-slate-500">{message}</span>}
    </div>
  );
}

// AI schedule import: paste the schedule text off a team's official site, an AI Prompt cloud
// flow extracts the home games, preview, then import -- mirrors the original's ScheduleImportModal
// (which called Claude directly); this environment has no Anthropic access, so it goes through the
// "PowerAppV2 -> Run a prompt" cloud flow instead. Dedupes against games already in this season by
// date+opponent, same spirit as the alternate-key uniqueness the original schema had.
function AiScheduleImportModal({
  team,
  seasonId,
  existingGames,
  onClose,
  onImported,
}: {
  team: Cr9cd_teams;
  seasonId: string;
  existingGames: Cr9cd_games[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [pastedText, setPastedText] = useState('');
  const [ticketMode, setTicketMode] = useState<'per_game' | 'total'>('per_game');
  const [perGame, setPerGame] = useState(String(team.cr9cd_default_tickets_per_game ?? 0));
  const [totalTickets, setTotalTickets] = useState('');
  const [games, setGames] = useState<ExtractedGame[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ imported: number; skipped: number; seatsCreated: number } | null>(null);

  const gameCount = games?.length ?? 0;
  const spreadPerGame = ticketMode === 'total' && gameCount > 0 ? Math.floor((Number(totalTickets) || 0) / gameCount) : null;
  const spreadRemainder = ticketMode === 'total' && gameCount > 0 ? (Number(totalTickets) || 0) % gameCount : 0;

  const existingKeys = new Set(
    existingGames.map((g) => `${g.cr9cd_game_date ? new Date(g.cr9cd_game_date).toDateString() : ''}|${(g.cr9cd_opponent ?? '').trim().toLowerCase()}`)
  );

  async function parse() {
    if (!pastedText.trim()) return;
    setParsing(true);
    setError('');
    try {
      const extracted = await extractScheduleFromText(team.cr9cd_name ?? 'Team', pastedText);
      setGames(extracted);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setParsing(false);
    }
  }

  async function doImport() {
    if (!games) return;
    setImporting(true);
    setError('');
    try {
      let imported = 0;
      let skipped = 0;
      let seatsCreated = 0;
      for (let i = 0; i < games.length; i++) {
        const g = games[i];
        const key = `${new Date(g.gameDate).toDateString()}|${g.opponent.trim().toLowerCase()}`;
        if (existingKeys.has(key)) {
          skipped++;
          continue;
        }
        const seatCount =
          ticketMode === 'total' ? (spreadPerGame ?? 0) + (i < spreadRemainder ? 1 : 0) : Number(perGame) || 0;
        const created = await Cr9cd_gamesService.create({
          cr9cd_game_date: new Date(g.gameDate).toISOString(),
          cr9cd_opponent: g.opponent,
          cr9cd_promotions: g.promotions ?? '',
          'cr9cd_Season@odata.bind': bindRef('cr9cd_seasons', seasonId),
          cr9cd_status: gameStatusChoice.toCode('scheduled'),
          cr9cd_kind: gameKindChoice.toCode('game'),
          cr9cd_total_seats: seatCount,
        } as Parameters<typeof Cr9cd_gamesService.create>[0]);
        imported++;
        const gameId = created.data?.cr9cd_gameid;
        if (gameId && seatCount > 0) {
          for (let s = 1; s <= seatCount; s++) {
            await Cr9cd_seatsService.create({
              'cr9cd_Game@odata.bind': bindRef('cr9cd_games', gameId),
              cr9cd_section: 'GA',
              cr9cd_row: '1',
              cr9cd_seat_number: String(s),
              cr9cd_status: seatStatusChoice.toCode('available'),
            } as Parameters<typeof Cr9cd_seatsService.create>[0]);
            seatsCreated++;
          }
        }
      }
      setResult({ imported, skipped, seatsCreated });
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Import schedule (AI)"
      description={`Paste ${team.cr9cd_name ?? 'the team'}'s home schedule from its official site — an AI flow turns it into games.`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {!games ? (
            <Button loading={parsing} disabled={!pastedText.trim()} onClick={parse}>
              Parse schedule
            </Button>
          ) : (
            <Button loading={importing} disabled={!!result} onClick={doImport}>
              Import {games.length} game{games.length === 1 ? '' : 's'}
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
            <Field label="Tickets per game" hint="Seats auto-created for every new game">
              <TextInput type="number" min="0" value={perGame} onChange={(e) => setPerGame(e.target.value)} />
            </Field>
          ) : (
            <Field
              label="Total tickets for the season"
              hint={
                gameCount > 0
                  ? `≈ ${spreadPerGame} per game across ${gameCount} games (remainder goes to the earliest games)`
                  : 'Spread evenly once the schedule is parsed'
              }
            >
              <TextInput type="number" min="0" value={totalTickets} onChange={(e) => setTotalTickets(e.target.value)} placeholder="e.g. 800" />
            </Field>
          )}
        </div>

        {parsing && (
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4">
            <Spinner size="sm" />
            <span className="text-sm text-slate-600">Parsing the schedule…</span>
          </div>
        )}

        {games && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{games.length} home games found</div>
            <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {games.map((g, i) => {
                    const key = `${new Date(g.gameDate).toDateString()}|${g.opponent.trim().toLowerCase()}`;
                    const isDup = existingKeys.has(key);
                    return (
                      <tr key={i} className={isDup ? 'opacity-50' : undefined}>
                        <td className="px-3 py-1.5 text-slate-500">{formatDateTime(g.gameDate)}</td>
                        <td className="px-3 py-1.5 font-medium text-slate-800">vs {g.opponent}</td>
                        <td className="px-3 py-1.5 text-xs text-slate-400">{g.promotions ?? ''}</td>
                        <td className="px-3 py-1.5 text-xs text-slate-400">{isDup ? 'Already in season' : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Imported {result.imported} game(s) ({result.skipped} skipped as duplicates), created {result.seatsCreated} seats.
          </div>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

// New-team creation, mirrors the original NewTeamModal — official website is used later to pull the schedule.
function NewTeamModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [abbreviation, setAbbreviation] = useState('');
  const [sport, setSport] = useState('');
  const [venue, setVenue] = useState('');
  const [officialUrl, setOfficialUrl] = useState('');
  const [tickets, setTickets] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await Cr9cd_teamsService.create({
        cr9cd_name: name,
        cr9cd_abbreviation: abbreviation || undefined,
        cr9cd_sport: sport || undefined,
        cr9cd_venue: venue || undefined,
        cr9cd_official_url: officialUrl || undefined,
        cr9cd_default_tickets_per_game: Number(tickets) || 0,
      } as Parameters<typeof Cr9cd_teamsService.create>[0]);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New team"
      description="Enter the team's details. The official website is used later to pull its schedule."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!name.trim()} onClick={create}>
            Add team
          </Button>
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
        <Field label="Official website" hint="Optional — used later to pull the schedule">
          <TextInput value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} placeholder="https://www.vegasgoldenknights.com/schedule/" />
        </Field>
        <Field label="Default tickets / game" hint="Seats auto-created on schedule import">
          <TextInput type="number" min="0" value={tickets} onChange={(e) => setTickets(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

// Editable team settings: identity, official website, default tickets, and delete — mirrors the
// original TeamSettings panel, ported into a Modal to match the rest of the restored interaction pattern.
function TeamSettingsModal({
  team,
  onClose,
  onSaved,
  onDeleted,
}: {
  team: Cr9cd_teams;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(team.cr9cd_name ?? '');
  const [abbreviation, setAbbreviation] = useState(team.cr9cd_abbreviation ?? '');
  const [sport, setSport] = useState(team.cr9cd_sport ?? '');
  const [venue, setVenue] = useState(team.cr9cd_venue ?? '');
  const [officialUrl, setOfficialUrl] = useState(team.cr9cd_official_url ?? '');
  const [tickets, setTickets] = useState(String(team.cr9cd_default_tickets_per_game ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    setBusy(true);
    setError('');
    try {
      await Cr9cd_teamsService.update(team.cr9cd_teamid, {
        cr9cd_name: name,
        cr9cd_abbreviation: abbreviation,
        cr9cd_sport: sport,
        cr9cd_venue: venue,
        cr9cd_official_url: officialUrl,
        cr9cd_default_tickets_per_game: Number(tickets) || 0,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      const { seasons } = await countTeamDependents(team.cr9cd_teamid);
      const summary = seasons > 0 ? ` — ${seasons} season(s) and everything scheduled under them` : '';
      if (!window.confirm(`Delete team "${team.cr9cd_name}"${summary}? This cannot be undone.`)) {
        setBusy(false);
        return;
      }
      await deleteTeam(team.cr9cd_teamid);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${team.cr9cd_name} — settings`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button loading={busy} onClick={save}>
            Save settings
          </Button>
        </>
      }
    >
      <div className="space-y-4">
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
          <Field label="Official website" hint="Used by schedule import" className="sm:col-span-2">
            <TextInput value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} placeholder="https://www.team.com/schedule" />
          </Field>
          <Field label="Default tickets / game" hint="Seats auto-created on import">
            <TextInput type="number" min="0" value={tickets} onChange={(e) => setTickets(e.target.value)} />
          </Field>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
          {confirmDelete ? (
            <>
              <span className="text-xs text-rose-700">Delete team and everything scheduled under it?</span>
              <Button size="sm" variant="danger" loading={busy} onClick={remove}>
                Confirm delete
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete team
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Create a season for a team — mirrors the original CreateSeasonModal.
function CreateSeasonModal({ teamId, onClose, onCreated }: { teamId: string; onClose: () => void; onCreated: () => void }) {
  const [label, setLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    if (!label.trim()) return;
    setBusy(true);
    setError('');
    try {
      await Cr9cd_seasonsService.create({
        cr9cd_name: label,
        'cr9cd_Team@odata.bind': bindRef('cr9cd_teams', teamId),
        cr9cd_start_date: startDate ? dateOnlyToIso(startDate) : undefined,
        cr9cd_end_date: endDate ? dateOnlyToIso(endDate) : undefined,
        cr9cd_status: seasonStatusChoice.toCode('draft'),
      } as Parameters<typeof Cr9cd_seasonsService.create>[0]);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New season"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!label.trim()} onClick={create}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Label" required>
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="2025-26 Regular Season" required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date">
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End date">
            <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

function EditSeasonModal({ season, onClose, onSaved }: { season: Cr9cd_seasons; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(season.cr9cd_name ?? '');
  const [startDate, setStartDate] = useState(isoToDateOnlyInput(season.cr9cd_start_date));
  const [endDate, setEndDate] = useState(isoToDateOnlyInput(season.cr9cd_end_date));
  const [status, setStatus] = useState<SeasonStatus>(season.cr9cd_status != null ? seasonStatusChoice.toValue(season.cr9cd_status) : 'draft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await Cr9cd_seasonsService.update(season.cr9cd_seasonid, {
        cr9cd_name: name,
        cr9cd_start_date: startDate ? dateOnlyToIso(startDate) : undefined,
        cr9cd_end_date: endDate ? dateOnlyToIso(endDate) : undefined,
        cr9cd_status: seasonStatusChoice.toCode(status),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit season"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!name.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Label" required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date">
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End date">
            <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as SeasonStatus)}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </Select>
        </Field>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

// Compact per-game control to move a game/event into a different season, possibly under a
// different team — seasons aren't scoped to a single team's list, so options span every season.
function MoveGameSelect({ game, allSeasons, onMoved }: { game: Cr9cd_games; allSeasons: Cr9cd_seasons[]; onMoved: () => void }) {
  const [busy, setBusy] = useState(false);

  async function move(seasonId: string) {
    if (!seasonId || seasonId === game._cr9cd_season_value) return;
    setBusy(true);
    try {
      await Cr9cd_gamesService.update(game.cr9cd_gameid, {
        'cr9cd_Season@odata.bind': bindRef('cr9cd_seasons', seasonId),
      });
      onMoved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      className="input w-auto shrink-0 py-1 text-xs"
      value={game._cr9cd_season_value ?? ''}
      disabled={busy}
      onChange={(e) => move(e.target.value)}
      title="Move to season"
    >
      {allSeasons.map((s) => (
        <option key={s.cr9cd_seasonid} value={s.cr9cd_seasonid}>
          {s.cr9cd_teamname ?? 'Team'} — {s.cr9cd_name}
        </option>
      ))}
    </select>
  );
}

// Add a game/event to a season — mirrors the original AddGameModal.
function AddGameModal({ seasonId, onClose, onCreated }: { seasonId: string; onClose: () => void; onCreated: () => void }) {
  const [kind, setKind] = useState<GameKind>('game');
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [seatCount, setSeatCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    if (!date || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const created = await Cr9cd_gamesService.create({
        cr9cd_game_date: dateOnlyToIso(date),
        cr9cd_opponent: kind === 'game' ? name : '',
        cr9cd_title: kind === 'event' ? name : '',
        'cr9cd_Season@odata.bind': bindRef('cr9cd_seasons', seasonId),
        cr9cd_status: gameStatusChoice.toCode('scheduled'),
        cr9cd_kind: gameKindChoice.toCode(kind),
        cr9cd_total_seats: seatCount,
      } as Parameters<typeof Cr9cd_gamesService.create>[0]);
      const gameId = created.data?.cr9cd_gameid;
      if (gameId && seatCount > 0) {
        for (let i = 1; i <= seatCount; i++) {
          await Cr9cd_seatsService.create({
            'cr9cd_Game@odata.bind': bindRef('cr9cd_games', gameId),
            cr9cd_section: 'GA',
            cr9cd_row: '1',
            cr9cd_seat_number: String(i),
            cr9cd_status: seatStatusChoice.toCode('available'),
          } as Parameters<typeof Cr9cd_seatsService.create>[0]);
        }
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={kind === 'event' ? 'Add event' : 'Add game'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!date || !name.trim()} onClick={create}>
            {kind === 'event' ? 'Add event' : 'Add game'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as GameKind)}>
            <option value="game">Game</option>
            <option value="event">Event</option>
          </Select>
        </Field>
        <Field label="Date" required>
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label={kind === 'event' ? 'Event title' : 'Opponent'} required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Seats to create">
          <TextInput type="number" min={0} value={seatCount} onChange={(e) => setSeatCount(Number(e.target.value))} />
        </Field>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

function TeamSeasons({
  team,
  allSeasons,
  onSeasonsChanged,
  onTeamChanged,
}: {
  team: Cr9cd_teams;
  allSeasons: Cr9cd_seasons[];
  onSeasonsChanged: () => void;
  onTeamChanged: () => void;
}) {
  const [games, setGames] = useState<Record<string, Cr9cd_games[]>>({});
  const [busy, setBusy] = useState(false);
  const [editingSeasonId, setEditingSeasonId] = useState<string | null>(null);
  const [showCreateSeason, setShowCreateSeason] = useState(false);
  const [addGameSeasonId, setAddGameSeasonId] = useState<string | null>(null);
  const [aiImportSeasonId, setAiImportSeasonId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const seasons = allSeasons.filter((s) => s._cr9cd_team_value === team.cr9cd_teamid);
  const seasonIds = seasons.map((s) => s.cr9cd_seasonid).join(',');
  const editingSeason = seasons.find((s) => s.cr9cd_seasonid === editingSeasonId) ?? null;

  const loadGames = useCallback(async () => {
    const gamesBySeasonId: Record<string, Cr9cd_games[]> = {};
    for (const season of seasons) {
      const gamesResult = await Cr9cd_gamesService.getAll({
        filter: `_cr9cd_season_value eq ${season.cr9cd_seasonid}`,
        orderBy: ['cr9cd_game_date asc'],
      });
      gamesBySeasonId[season.cr9cd_seasonid] = gamesResult.data ?? [];
    }
    setGames(gamesBySeasonId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonIds]);

  useEffect(() => {
    loadGames();
  }, [loadGames]);

  async function reloadAll() {
    await Promise.all([loadGames(), onSeasonsChanged()]);
  }

  async function setSeasonStatus(seasonId: string, status: SeasonStatus) {
    setBusy(true);
    try {
      await Cr9cd_seasonsService.update(seasonId, { cr9cd_status: seasonStatusChoice.toCode(status) });
      await onSeasonsChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-4 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{team.cr9cd_name}</h3>
          <p className="text-sm text-slate-500">
            {team.cr9cd_sport} &middot; {team.cr9cd_venue}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setShowSettings(true)}>
            Settings
          </Button>
          <Button size="sm" onClick={() => setShowCreateSeason(true)}>
            New season
          </Button>
        </div>
      </div>

      {seasons.map((season) => (
        <div key={season.cr9cd_seasonid} className="mb-4 rounded-lg border border-slate-200 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <strong className="text-sm text-slate-900">{season.cr9cd_name}</strong>
            <Badge status={season.cr9cd_status != null ? seasonStatusChoice.toValue(season.cr9cd_status) : 'draft'} />
            {season.cr9cd_start_date && (
              <span className="text-xs text-slate-400">
                {formatDateOnly(season.cr9cd_start_date)}
                {season.cr9cd_end_date ? ` – ${formatDateOnly(season.cr9cd_end_date)}` : ''}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <ScheduleTemplateButtons seasonId={season.cr9cd_seasonid} onImported={loadGames} />
              <Button size="sm" variant="secondary" onClick={() => setAiImportSeasonId(season.cr9cd_seasonid)}>
                Import (AI)
              </Button>
              <ExportButton seasonId={season.cr9cd_seasonid} />
              <Button size="sm" variant="secondary" onClick={() => setAddGameSeasonId(season.cr9cd_seasonid)}>
                Add game
              </Button>
              {(season.cr9cd_status != null ? seasonStatusChoice.toValue(season.cr9cd_status) : 'draft') !== 'active' ? (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setSeasonStatus(season.cr9cd_seasonid, 'active')}>
                  Mark active
                </Button>
              ) : (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setSeasonStatus(season.cr9cd_seasonid, 'completed')}>
                  Mark complete
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => setEditingSeasonId(season.cr9cd_seasonid)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const { games: gameCount } = await countSeasonDependents(season.cr9cd_seasonid);
                    const summary = gameCount > 0 ? ` — ${gameCount} game(s)/event(s) and everything tied to them` : '';
                    if (!window.confirm(`Delete season "${season.cr9cd_name}"${summary}? This cannot be undone.`)) return;
                    await deleteSeason(season.cr9cd_seasonid);
                    await onSeasonsChanged();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </div>

          <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-100">
            {(games[season.cr9cd_seasonid] ?? []).map((game) => {
              const kind: GameKind = game.cr9cd_kind != null ? gameKindChoice.toValue(game.cr9cd_kind) : 'game';
              const label = kind === 'event' ? game.cr9cd_title : `vs ${game.cr9cd_opponent}`;
              return (
                <div key={game.cr9cd_gameid} className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                  <Link to={`/games/${game.cr9cd_gameid}`} className="truncate text-slate-700 hover:underline">
                    {game.cr9cd_game_date ? new Date(game.cr9cd_game_date).toLocaleDateString() : '(no date)'} {label}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge status={game.cr9cd_status != null ? gameStatusChoice.toValue(game.cr9cd_status) : 'scheduled'} />
                    <MoveGameSelect game={game} allSeasons={allSeasons} onMoved={reloadAll} />
                  </span>
                </div>
              );
            })}
            {(games[season.cr9cd_seasonid] ?? []).length === 0 && <div className="px-3 py-4 text-center text-sm text-slate-400">No games yet.</div>}
          </div>
        </div>
      ))}

      {seasons.length === 0 && <div className="mb-2 text-sm text-slate-400">No seasons yet — add one to start scheduling.</div>}

      {showCreateSeason && (
        <CreateSeasonModal
          teamId={team.cr9cd_teamid}
          onClose={() => setShowCreateSeason(false)}
          onCreated={async () => {
            setShowCreateSeason(false);
            await onSeasonsChanged();
          }}
        />
      )}

      {editingSeason && (
        <EditSeasonModal
          season={editingSeason}
          onClose={() => setEditingSeasonId(null)}
          onSaved={async () => {
            setEditingSeasonId(null);
            await onSeasonsChanged();
          }}
        />
      )}

      {addGameSeasonId && (
        <AddGameModal
          seasonId={addGameSeasonId}
          onClose={() => setAddGameSeasonId(null)}
          onCreated={async () => {
            setAddGameSeasonId(null);
            await loadGames();
          }}
        />
      )}

      {aiImportSeasonId && (
        <AiScheduleImportModal
          team={team}
          seasonId={aiImportSeasonId}
          existingGames={games[aiImportSeasonId] ?? []}
          onClose={() => setAiImportSeasonId(null)}
          onImported={loadGames}
        />
      )}

      {showSettings && (
        <TeamSettingsModal
          team={team}
          onClose={() => setShowSettings(false)}
          onSaved={async () => {
            setShowSettings(false);
            await onTeamChanged();
          }}
          onDeleted={async () => {
            setShowSettings(false);
            await onTeamChanged();
          }}
        />
      )}
    </div>
  );
}

export default function TeamsPage() {
  const { user } = useAuth();
  const [teams, setTeams] = useState<Cr9cd_teams[]>([]);
  const [allSeasons, setAllSeasons] = useState<Cr9cd_seasons[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [showNotify, setShowNotify] = useState(false);

  const loadSeasons = useCallback(async () => {
    const result = await Cr9cd_seasonsService.getAll({ orderBy: ['cr9cd_name asc'] });
    setAllSeasons(result.data ?? []);
  }, []);

  const loadTeams = useCallback(async () => {
    const result = await Cr9cd_teamsService.getAll({ orderBy: ['cr9cd_name asc'] });
    setTeams(result.data ?? []);
  }, []);

  useEffect(() => {
    Promise.all([loadTeams(), loadSeasons()]).then(() => setLoading(false));
  }, [loadTeams, loadSeasons]);

  return (
    <div>
      <PageHeader
        title="Teams & Seasons"
        subtitle="Manage seasons and schedules for each team"
        actions={
          <>
            {user?.isAdmin && (
              <Button variant="secondary" onClick={() => setShowNotify(true)}>
                Send availability
              </Button>
            )}
            <Button onClick={() => setShowNewTeam(true)}>New team</Button>
          </>
        }
      />

      {showNotify && <NotifyAvailabilityModal onClose={() => setShowNotify(false)} />}
      {loading ? (
        <div className="card flex items-center justify-center p-12">
          <Spinner label="Loading teams…" />
        </div>
      ) : (
        teams.map((team) => (
          <TeamSeasons key={team.cr9cd_teamid} team={team} allSeasons={allSeasons} onSeasonsChanged={loadSeasons} onTeamChanged={loadTeams} />
        ))
      )}

      {showNewTeam && (
        <NewTeamModal
          onClose={() => setShowNewTeam(false)}
          onCreated={async () => {
            setShowNewTeam(false);
            await loadTeams();
          }}
        />
      )}
    </div>
  );
}
