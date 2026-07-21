import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_seasonsService } from '../generated/services/Cr9cd_seasonsService';
import { Cr9cd_teamsService } from '../generated/services/Cr9cd_teamsService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import type { Cr9cd_games } from '../generated/models/Cr9cd_gamesModel';
import { gameKindChoice, seatStatusChoice, seasonStatusChoice } from '../dataverse/choiceMaps';
import { formatDate } from '../lib/format';
import { SEASON_FILTER_STATUS, type SeasonStatus } from '../domain/enums';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Field, Select } from '../components/Field';
import { AiCreateButton } from '../components/AiCreateModal';
import NotifyAvailabilityModal from '../components/NotifyAvailabilityModal';
import { useAuth } from '../auth/AuthContext';

interface SeasonInfo {
  teamId: string | undefined;
  teamName: string;
  status: SeasonStatus;
}

export default function GamesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showNotify, setShowNotify] = useState(false);
  const [games, setGames] = useState<Cr9cd_games[]>([]);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [seasonInfo, setSeasonInfo] = useState<Record<string, SeasonInfo>>({});
  const [seatCounts, setSeatCounts] = useState<Record<string, { total: number; available: number }>>({});
  const [loading, setLoading] = useState(true);

  // Filters
  const [teamId, setTeamId] = useState('');
  const [seasonStatus, setSeasonStatus] = useState<SeasonStatus | ''>('active');
  const [onlyAvailable, setOnlyAvailable] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([
      Cr9cd_gamesService.getAll({ filter: `cr9cd_kind eq ${gameKindChoice.toCode('game')}`, orderBy: ['cr9cd_game_date asc'] }),
      Cr9cd_seasonsService.getAll({ select: ['cr9cd_seasonid', 'cr9cd_teamname', 'cr9cd_status', '_cr9cd_team_value'] }),
      Cr9cd_teamsService.getAll({ select: ['cr9cd_teamid', 'cr9cd_name'], orderBy: ['cr9cd_name asc'] }),
      Cr9cd_seatsService.getAll({ select: ['cr9cd_status', '_cr9cd_game_value'] }),
    ]).then(([gamesResult, seasonsResult, teamsResult, seatsResult]) => {
      setGames(gamesResult.data ?? []);
      setTeams((teamsResult.data ?? []).map((t) => ({ id: t.cr9cd_teamid, name: t.cr9cd_name ?? 'Team' })));

      const seasons: Record<string, SeasonInfo> = {};
      for (const s of seasonsResult.data ?? []) {
        seasons[s.cr9cd_seasonid] = {
          teamId: s._cr9cd_team_value,
          teamName: s.cr9cd_teamname ?? '',
          status: s.cr9cd_status != null ? seasonStatusChoice.toValue(s.cr9cd_status) : 'draft',
        };
      }
      setSeasonInfo(seasons);

      const counts: Record<string, { total: number; available: number }> = {};
      for (const seat of seatsResult.data ?? []) {
        const gid = seat._cr9cd_game_value;
        if (!gid) continue;
        const bucket = counts[gid] ?? { total: 0, available: 0 };
        bucket.total += 1;
        const status = seat.cr9cd_status != null ? seatStatusChoice.toValue(seat.cr9cd_status) : 'available';
        if (status === 'available') bucket.available += 1;
        counts[gid] = bucket;
      }
      setSeatCounts(counts);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredGames = useMemo(
    () =>
      games.filter((g) => {
        const season = g._cr9cd_season_value ? seasonInfo[g._cr9cd_season_value] : undefined;
        if (seasonStatus && season?.status !== seasonStatus) return false;
        if (teamId && season?.teamId !== teamId) return false;
        if (onlyAvailable && (seatCounts[g.cr9cd_gameid]?.available ?? 0) <= 0) return false;
        return true;
      }),
    [games, seasonInfo, seatCounts, seasonStatus, teamId, onlyAvailable]
  );

  const columns: Column<Cr9cd_games>[] = [
    { key: 'date', header: 'Date', render: (g) => formatDate(g.cr9cd_game_date) },
    {
      key: 'opp',
      header: 'Opponent',
      render: (g) => <span className="font-medium text-slate-900">vs {g.cr9cd_opponent}</span>,
    },
    {
      key: 'season',
      header: 'Team / Season',
      render: (g) => {
        const season = g._cr9cd_season_value ? seasonInfo[g._cr9cd_season_value] : undefined;
        return (
          <span className="inline-flex items-center gap-2">
            <span className="text-slate-500">
              {season?.teamName ?? ''}
              {g.cr9cd_seasonname ? ` — ${g.cr9cd_seasonname}` : ''}
            </span>
            {season && <Badge status={season.status} />}
          </span>
        );
      },
    },
    { key: 'promo', header: 'Promotions', render: (g) => g.cr9cd_promotions || <span className="text-slate-400">—</span> },
    { key: 'total', header: 'Total seats', align: 'right', render: (g) => seatCounts[g.cr9cd_gameid]?.total ?? 0 },
    {
      key: 'available',
      header: 'Available',
      align: 'right',
      render: (g) => {
        const available = seatCounts[g.cr9cd_gameid]?.available ?? 0;
        return <span className={available > 0 ? 'font-medium text-emerald-700' : 'text-slate-400'}>{available}</span>;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Games"
        subtitle="Every scheduled game across all teams and seasons."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Team" className="w-44">
              <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">All teams</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Season" className="w-40">
              <Select value={seasonStatus} onChange={(e) => setSeasonStatus(e.target.value as SeasonStatus | '')}>
                <option value="">All seasons</option>
                {SEASON_FILTER_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {s === 'active' ? 'Active' : 'Completed'} seasons
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex h-10 items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Available seats only
            </label>
            {user?.isAdmin && (
              <Button variant="secondary" onClick={() => setShowNotify(true)}>
                Send availability
              </Button>
            )}
            <AiCreateButton onChanged={load} />
          </div>
        }
      />

      {showNotify && <NotifyAvailabilityModal onClose={() => setShowNotify(false)} />}

      <DataTable
        columns={columns}
        rows={filteredGames}
        loading={loading}
        keyFn={(g) => g.cr9cd_gameid}
        onRowClick={(g) => navigate(`/games/${g.cr9cd_gameid}`)}
        emptyTitle="No games"
        emptyDescription="Games appear here once seasons are scheduled."
      />
    </div>
  );
}
