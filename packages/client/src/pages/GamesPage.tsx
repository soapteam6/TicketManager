import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { SEASON_FILTER_STATUS } from '@ais/shared';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { Game, Team } from '@/lib/types';
import { pickArray } from '@/lib/unwrap';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Field, Select } from '@/components/Field';
import { RoleGate } from '@/auth/AuthContext';
import { NotifyAvailabilityModal } from '@/components/NotifyAvailabilityModal';

export function GamesPage() {
  const navigate = useNavigate();
  const [seasonStatus, setSeasonStatus] = useState('active');
  const [teamId, setTeamId] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [showNotify, setShowNotify] = useState(false);

  const teams = useQuery({
    queryKey: ['teams'],
    queryFn: async () => pickArray<Team>((await api.get('/teams')).data, 'teams'),
    staleTime: 60_000,
  });

  const games = useQuery({
    queryKey: ['games', { seasonStatus, teamId }],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (seasonStatus) params.seasonStatus = seasonStatus;
      if (teamId) params.teamId = teamId;
      const res = await api.get('/games', { params: Object.keys(params).length ? params : undefined });
      return pickArray<Game>(res.data, 'games');
    },
  });

  const rows = onlyAvailable ? games.data?.filter((g) => (g.availableSeats ?? 0) > 0) : games.data;

  const columns: Column<Game>[] = [
    { key: 'date', header: 'Date', render: (g) => formatDate(g.gameDate) },
    { key: 'opp', header: 'Opponent', render: (g) => <span className="font-medium text-slate-900">vs {g.opponent}</span> },
    {
      key: 'season',
      header: 'Season',
      render: (g) => (
        <div className="flex items-center gap-2">
          <span className="text-slate-600">{g.seasonLabel ?? '—'}</span>
          {g.seasonStatus && <Badge status={g.seasonStatus} />}
        </div>
      ),
    },
    { key: 'promo', header: 'Promotions', render: (g) => g.promotions || <span className="text-slate-400">—</span> },
    { key: 'seats', header: 'Total seats', align: 'right', render: (g) => g.totalSeats },
    { key: 'available', header: 'Available', align: 'right', render: (g) => g.availableSeats ?? 0 },
  ];

  return (
    <div>
      <PageHeader
        title="Games"
        subtitle="Every scheduled game across all active seasons."
        actions={
          <>
            <Field className="w-44">
              <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">All teams</option>
                {teams.data?.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field className="w-44">
              <Select value={seasonStatus} onChange={(e) => setSeasonStatus(e.target.value)}>
                <option value="">All seasons</option>
                {SEASON_FILTER_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {s === 'active' ? 'Active seasons' : 'Completed seasons'}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Available seats only
            </label>
            <RoleGate roles={['admin']}>
              <Button variant="secondary" onClick={() => setShowNotify(true)}>Send availability</Button>
            </RoleGate>
          </>
        }
      />

      {showNotify && <NotifyAvailabilityModal onClose={() => setShowNotify(false)} />}

      <QueryState isLoading={games.isLoading} error={games.error}>
        <DataTable
          columns={columns}
          rows={rows}
          keyFn={(g) => g.id}
          onRowClick={(g) => navigate(`/games/${g.id}`)}
          emptyTitle="No games"
          emptyDescription="Games appear here once seasons are scheduled."
        />
      </QueryState>
    </div>
  );
}
