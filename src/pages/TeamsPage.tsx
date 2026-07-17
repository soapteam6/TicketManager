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
import type { GameKind } from '../domain/enums';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { TextInput, Select } from '../components/Field';
import { Spinner } from '../components/Spinner';

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

function TeamSeasons({ team }: { team: Cr9cd_teams }) {
  const [seasons, setSeasons] = useState<Cr9cd_seasons[]>([]);
  const [games, setGames] = useState<Record<string, Cr9cd_games[]>>({});
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await Cr9cd_seasonsService.getAll({ filter: `_cr9cd_team_value eq ${team.cr9cd_teamid}` });
    const rows = result.data ?? [];
    setSeasons(rows);
    const gamesBySeasonId: Record<string, Cr9cd_games[]> = {};
    for (const season of rows) {
      const gamesResult = await Cr9cd_gamesService.getAll({
        filter: `_cr9cd_season_value eq ${season.cr9cd_seasonid}`,
        orderBy: ['cr9cd_game_date asc'],
      });
      gamesBySeasonId[season.cr9cd_seasonid] = gamesResult.data ?? [];
    }
    setGames(gamesBySeasonId);
  }, [team.cr9cd_teamid]);

  useEffect(() => {
    load();
  }, [load]);

  async function createSeason() {
    if (!newLabel.trim()) return;
    setBusy(true);
    try {
      await Cr9cd_seasonsService.create({
        cr9cd_name: newLabel,
        'cr9cd_Team@odata.bind': bindRef('cr9cd_teams', team.cr9cd_teamid),
        cr9cd_status: seasonStatusChoice.toCode('draft'),
      } as Parameters<typeof Cr9cd_seasonsService.create>[0]);
      setNewLabel('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-4 p-5">
      <h3 className="text-base font-semibold text-slate-900">{team.cr9cd_name}</h3>
      <p className="mb-4 text-sm text-slate-500">
        {team.cr9cd_sport} &middot; {team.cr9cd_venue}
      </p>

      {seasons.map((season) => (
        <div key={season.cr9cd_seasonid} className="mb-4 rounded-lg border border-slate-200 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <strong className="text-sm text-slate-900">{season.cr9cd_name}</strong>
            <Badge status={season.cr9cd_status != null ? seasonStatusChoice.toValue(season.cr9cd_status) : 'draft'} />
            <div className="ml-auto flex items-center gap-2">
              <ScheduleTemplateButtons seasonId={season.cr9cd_seasonid} onImported={load} />
              <ExportButton seasonId={season.cr9cd_seasonid} />
            </div>
          </div>

          <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-100">
            {(games[season.cr9cd_seasonid] ?? []).map((game) => {
              const kind: GameKind = game.cr9cd_kind != null ? gameKindChoice.toValue(game.cr9cd_kind) : 'game';
              const label = kind === 'event' ? game.cr9cd_title : `vs ${game.cr9cd_opponent}`;
              return (
                <Link
                  key={game.cr9cd_gameid}
                  to={`/games/${game.cr9cd_gameid}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <span className="truncate text-slate-700">
                    {game.cr9cd_game_date ? new Date(game.cr9cd_game_date).toLocaleDateString() : '(no date)'} {label}
                  </span>
                  <Badge status={game.cr9cd_status != null ? gameStatusChoice.toValue(game.cr9cd_status) : 'scheduled'} />
                </Link>
              );
            })}
            {(games[season.cr9cd_seasonid] ?? []).length === 0 && <div className="px-3 py-4 text-center text-sm text-slate-400">No games yet.</div>}
          </div>

          <NewGameForm seasonId={season.cr9cd_seasonid} onCreated={load} />
        </div>
      ))}

      <div className="flex gap-2">
        <TextInput placeholder="New season label (e.g. 2025-26)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
        <Button disabled={busy} loading={busy} onClick={createSeason}>
          Add season
        </Button>
      </div>
    </div>
  );
}

function NewGameForm({ seasonId, onCreated }: { seasonId: string; onCreated: () => void }) {
  const [kind, setKind] = useState<GameKind>('game');
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [seatCount, setSeatCount] = useState(4);
  const [busy, setBusy] = useState(false);

  async function createGame() {
    if (!date || !name.trim()) return;
    setBusy(true);
    try {
      const created = await Cr9cd_gamesService.create({
        cr9cd_game_date: new Date(date).toISOString(),
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
      setDate('');
      setName('');
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Select value={kind} onChange={(e) => setKind(e.target.value as GameKind)} className="w-auto">
        <option value="game">Game</option>
        <option value="event">Event</option>
      </Select>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input w-auto" />
      <TextInput
        placeholder={kind === 'event' ? 'Event title' : 'Opponent'}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-auto flex-1"
      />
      <input
        type="number"
        min={0}
        value={seatCount}
        onChange={(e) => setSeatCount(Number(e.target.value))}
        title="Seats to create"
        className="input w-20"
      />
      <Button size="sm" variant="secondary" disabled={busy} loading={busy} onClick={createGame}>
        Add game
      </Button>
    </div>
  );
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<Cr9cd_teams[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Cr9cd_teamsService.getAll({ orderBy: ['cr9cd_name asc'] }).then((result) => {
      setTeams(result.data ?? []);
      setLoading(false);
    });
  }, []);

  return (
    <div>
      <PageHeader title="Teams & Seasons" subtitle="Manage seasons and schedules for each team" />
      {loading ? (
        <div className="card flex items-center justify-center p-12">
          <Spinner label="Loading teams…" />
        </div>
      ) : (
        teams.map((team) => <TeamSeasons key={team.cr9cd_teamid} team={team} />)
      )}
    </div>
  );
}
