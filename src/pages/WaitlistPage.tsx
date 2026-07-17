import { useEffect, useState } from 'react';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_waitlistentriesService } from '../generated/services/Cr9cd_waitlistentriesService';
import type { Cr9cd_games } from '../generated/models/Cr9cd_gamesModel';
import type { Cr9cd_waitlistentries } from '../generated/models/Cr9cd_waitlistentriesModel';
import { waitlistStatusChoice, gameKindChoice } from '../dataverse/choiceMaps';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Field';
import { DataTable, type Column } from '../components/DataTable';
import { Badge } from '../components/Badge';

export default function WaitlistPage() {
  const [games, setGames] = useState<Cr9cd_games[]>([]);
  const [gameId, setGameId] = useState('');
  const [entries, setEntries] = useState<Cr9cd_waitlistentries[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Cr9cd_gamesService.getAll({ orderBy: ['cr9cd_game_date desc'] }).then((result) => setGames(result.data ?? []));
  }, []);

  useEffect(() => {
    if (!gameId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    Cr9cd_waitlistentriesService
      .getAll({ filter: `_cr9cd_game_value eq ${gameId}`, orderBy: ['cr9cd_position asc'] })
      .then((result) => setEntries(result.data ?? []))
      .finally(() => setLoading(false));
  }, [gameId]);

  const columns: Column<Cr9cd_waitlistentries>[] = [
    { key: 'position', header: 'Position', render: (e) => e.cr9cd_position ?? '—', align: 'center' },
    { key: 'request', header: 'Request', render: (e) => e.cr9cd_ticket_requestname },
    {
      key: 'status',
      header: 'Status',
      render: (e) => <Badge status={e.cr9cd_status != null ? waitlistStatusChoice.toValue(e.cr9cd_status) : 'active'} />,
    },
    { key: 'reason', header: 'Reason', render: (e) => <span className="text-slate-500">{e.cr9cd_reason}</span> },
  ];

  return (
    <div>
      <PageHeader title="Waitlist" subtitle="Queued requests waiting on seat availability" />

      <div className="card mb-4 p-4">
        <Select value={gameId} onChange={(e) => setGameId(e.target.value)} className="max-w-md">
          <option value="">Select a game…</option>
          {games.map((g) => {
            const isEvent = (g.cr9cd_kind != null ? gameKindChoice.toValue(g.cr9cd_kind) : 'game') === 'event';
            const label = isEvent ? g.cr9cd_title : `vs ${g.cr9cd_opponent}`;
            return (
              <option key={g.cr9cd_gameid} value={g.cr9cd_gameid}>
                {g.cr9cd_game_date ? new Date(g.cr9cd_game_date).toLocaleDateString() : ''} {label}
              </option>
            );
          })}
        </Select>
      </div>

      {gameId && (
        <DataTable
          columns={columns}
          rows={entries}
          keyFn={(e) => e.cr9cd_waitlistentryid}
          loading={loading}
          emptyTitle="No waitlist entries"
          emptyDescription="Nobody is queued for this game right now."
        />
      )}
    </div>
  );
}
