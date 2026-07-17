import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_seasonsService } from '../generated/services/Cr9cd_seasonsService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import type { Cr9cd_games } from '../generated/models/Cr9cd_gamesModel';
import type { Cr9cd_seasons } from '../generated/models/Cr9cd_seasonsModel';
import { bindRef } from '../dataverse/bind';
import { gameStatusChoice, gameKindChoice, seatStatusChoice } from '../dataverse/choiceMaps';
import { formatDate } from '../lib/format';
import { GAME_STATUS, type GameStatus } from '../domain/enums';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Field, Select, TextInput, TextArea, EnumOptions } from '../components/Field';
import { Modal } from '../components/Modal';

// Custom events (title/description/date/tickets) — one-off ticketed events that aren't team games.
export default function EventsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<GameStatus | ''>('');
  const [events, setEvents] = useState<Cr9cd_games[]>([]);
  const [seasons, setSeasons] = useState<Cr9cd_seasons[]>([]);
  const [teamBySeasonId, setTeamBySeasonId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const filters = [`cr9cd_kind eq ${gameKindChoice.toCode('event')}`];
    if (status) filters.push(`cr9cd_status eq ${gameStatusChoice.toCode(status)}`);
    Promise.all([
      Cr9cd_gamesService.getAll({ filter: filters.join(' and '), orderBy: ['cr9cd_game_date asc'] }),
      Cr9cd_seasonsService.getAll({ orderBy: ['cr9cd_name asc'] }),
    ]).then(([eventsResult, seasonsResult]) => {
      setEvents(eventsResult.data ?? []);
      setSeasons(seasonsResult.data ?? []);
      const map: Record<string, string> = {};
      for (const s of seasonsResult.data ?? []) map[s.cr9cd_seasonid] = s.cr9cd_teamname ?? '';
      setTeamBySeasonId(map);
      setLoading(false);
    });
  }, [status]);

  useEffect(load, [load]);

  const columns: Column<Cr9cd_games>[] = [
    { key: 'date', header: 'Date', render: (e) => formatDate(e.cr9cd_game_date) },
    {
      key: 'title',
      header: 'Event',
      render: (e) => <span className="font-medium text-slate-900">{e.cr9cd_title}</span>,
    },
    {
      key: 'team',
      header: 'Team / Season',
      render: (e) => (
        <span className="text-slate-500">
          {e._cr9cd_season_value ? teamBySeasonId[e._cr9cd_season_value] : ''}
          {e.cr9cd_seasonname ? ` — ${e.cr9cd_seasonname}` : ''}
        </span>
      ),
    },
    { key: 'promo', header: 'Promotions', render: (e) => e.cr9cd_promotions || <span className="text-slate-400">—</span> },
    { key: 'seats', header: 'Seats', align: 'right', render: (e) => e.cr9cd_total_seats ?? 0 },
    {
      key: 'status',
      header: 'Status',
      render: (e) => <Badge status={e.cr9cd_status != null ? gameStatusChoice.toValue(e.cr9cd_status) : 'scheduled'} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Events"
        subtitle="Custom, one-off ticketed events that aren't team games — across all teams and seasons."
        actions={
          <>
            <Field className="w-48">
              <Select value={status} onChange={(e) => setStatus(e.target.value as GameStatus | '')}>
                <EnumOptions values={GAME_STATUS} includeBlank blankLabel="All statuses" />
              </Select>
            </Field>
            <Button onClick={() => setShowNew(true)}>New event</Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={events}
        loading={loading}
        keyFn={(e) => e.cr9cd_gameid}
        onRowClick={(e) => navigate(`/games/${e.cr9cd_gameid}`)}
        emptyTitle="No events"
        emptyDescription="Add an event from a season on the Teams & Seasons page, or use New event above."
      />

      {showNew && (
        <NewEventModal
          seasons={seasons}
          teamBySeasonId={teamBySeasonId}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            load();
          }}
        />
      )}
    </div>
  );
}

// Mirrors the original NewEventModal (title/description/date/tickets), adapted for this app's
// data model where every game/event must belong to a season -- so a Season picker replaces the
// original's implicit "Custom Events" pseudo-team.
function NewEventModal({
  seasons,
  teamBySeasonId,
  onClose,
  onCreated,
}: {
  seasons: Cr9cd_seasons[];
  teamBySeasonId: Record<string, string>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [seasonId, setSeasonId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [tickets, setTickets] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    if (!seasonId || !title.trim() || !date) return;
    setBusy(true);
    setError('');
    try {
      const seatCount = Number(tickets) || 0;
      const created = await Cr9cd_gamesService.create({
        cr9cd_title: title,
        cr9cd_description: description || undefined,
        cr9cd_game_date: new Date(date).toISOString(),
        'cr9cd_Season@odata.bind': bindRef('cr9cd_seasons', seasonId),
        cr9cd_status: gameStatusChoice.toCode('scheduled'),
        cr9cd_kind: gameKindChoice.toCode('event'),
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
      title="New event"
      description="A custom event with a title, description, date, and number of tickets."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!seasonId || !title.trim() || !date} onClick={create}>
            Create event
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Season" required hint="Which season's schedule this event belongs to">
          <Select value={seasonId} onChange={(e) => setSeasonId(e.target.value)} required>
            <option value="">Select a season…</option>
            {seasons.map((s) => (
              <option key={s.cr9cd_seasonid} value={s.cr9cd_seasonid}>
                {teamBySeasonId[s.cr9cd_seasonid] ?? 'Team'} — {s.cr9cd_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" required>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Client Appreciation Night" required />
        </Field>
        <Field label="Description">
          <TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Suite for key accounts, catered…" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date & time" required>
            <TextInput type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Number of tickets" hint="Seats to create">
            <TextInput type="number" min="0" value={tickets} onChange={(e) => setTickets(e.target.value)} />
          </Field>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}
