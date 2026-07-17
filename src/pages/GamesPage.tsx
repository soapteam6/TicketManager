import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_seasonsService } from '../generated/services/Cr9cd_seasonsService';
import type { Cr9cd_games } from '../generated/models/Cr9cd_gamesModel';
import { gameStatusChoice, gameKindChoice } from '../dataverse/choiceMaps';
import { formatDate } from '../lib/format';
import { GAME_STATUS, type GameStatus } from '../domain/enums';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Field, Select, EnumOptions } from '../components/Field';

export default function GamesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<GameStatus | ''>('');
  const [games, setGames] = useState<Cr9cd_games[]>([]);
  const [teamBySeasonId, setTeamBySeasonId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const filters = [`cr9cd_kind eq ${gameKindChoice.toCode('game')}`];
    if (status) filters.push(`cr9cd_status eq ${gameStatusChoice.toCode(status)}`);
    Promise.all([
      Cr9cd_gamesService.getAll({ filter: filters.join(' and '), orderBy: ['cr9cd_game_date asc'] }),
      Cr9cd_seasonsService.getAll({ select: ['cr9cd_seasonid', 'cr9cd_teamname'] }),
    ]).then(([gamesResult, seasonsResult]) => {
      setGames(gamesResult.data ?? []);
      const map: Record<string, string> = {};
      for (const s of seasonsResult.data ?? []) map[s.cr9cd_seasonid] = s.cr9cd_teamname ?? '';
      setTeamBySeasonId(map);
      setLoading(false);
    });
  }, [status]);

  const columns: Column<Cr9cd_games>[] = [
    { key: 'date', header: 'Date', render: (g) => formatDate(g.cr9cd_game_date) },
    {
      key: 'opp',
      header: 'Opponent',
      render: (g) => <span className="font-medium text-slate-900">vs {g.cr9cd_opponent}</span>,
    },
    {
      key: 'team',
      header: 'Team / Season',
      render: (g) => (
        <span className="text-slate-500">
          {g._cr9cd_season_value ? teamBySeasonId[g._cr9cd_season_value] : ''}
          {g.cr9cd_seasonname ? ` — ${g.cr9cd_seasonname}` : ''}
        </span>
      ),
    },
    { key: 'promo', header: 'Promotions', render: (g) => g.cr9cd_promotions || <span className="text-slate-400">—</span> },
    { key: 'seats', header: 'Seats', align: 'right', render: (g) => g.cr9cd_total_seats ?? 0 },
    {
      key: 'status',
      header: 'Status',
      render: (g) => <Badge status={g.cr9cd_status != null ? gameStatusChoice.toValue(g.cr9cd_status) : 'scheduled'} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Games"
        subtitle="Every scheduled game across all teams and seasons."
        actions={
          <Field className="w-48">
            <Select value={status} onChange={(e) => setStatus(e.target.value as GameStatus | '')}>
              <EnumOptions values={GAME_STATUS} includeBlank blankLabel="All statuses" />
            </Select>
          </Field>
        }
      />

      <DataTable
        columns={columns}
        rows={games}
        loading={loading}
        keyFn={(g) => g.cr9cd_gameid}
        onRowClick={(g) => navigate(`/games/${g.cr9cd_gameid}`)}
        emptyTitle="No games"
        emptyDescription="Games appear here once seasons are scheduled."
      />
    </div>
  );
}
