import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GAME_STATUS } from '@ais/shared';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { Game } from '@/lib/types';
import { pickArray } from '@/lib/unwrap';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { Field, Select, EnumOptions } from '@/components/Field';

export function GamesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');

  const games = useQuery({
    queryKey: ['games', { status }],
    queryFn: async () => {
      const res = await api.get('/games', { params: status ? { status } : undefined });
      return pickArray<Game>(res.data, 'games');
    },
  });

  const columns: Column<Game>[] = [
    { key: 'date', header: 'Date', render: (g) => formatDate(g.gameDate) },
    { key: 'opp', header: 'Opponent', render: (g) => <span className="font-medium text-slate-900">vs {g.opponent}</span> },
    { key: 'promo', header: 'Promotions', render: (g) => g.promotions || <span className="text-slate-400">—</span> },
    { key: 'seats', header: 'Seats', align: 'right', render: (g) => g.totalSeats },
    { key: 'status', header: 'Status', render: (g) => <Badge status={g.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Games"
        subtitle="Every scheduled game across all active seasons."
        actions={
          <Field className="w-48">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <EnumOptions values={GAME_STATUS} includeBlank blankLabel="All statuses" />
            </Select>
          </Field>
        }
      />

      <QueryState isLoading={games.isLoading} error={games.error}>
        <DataTable
          columns={columns}
          rows={games.data}
          keyFn={(g) => g.id}
          onRowClick={(g) => navigate(`/games/${g.id}`)}
          emptyTitle="No games"
          emptyDescription="Games appear here once seasons are scheduled."
        />
      </QueryState>
    </div>
  );
}
