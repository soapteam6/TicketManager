import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Game, WaitlistEntry } from '@/lib/types';
import { pickArray } from '@/lib/unwrap';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { Field, Select } from '@/components/Field';
import { EmptyState } from '@/components/EmptyState';

export function WaitlistPage() {
  const [gameId, setGameId] = useState('');

  const games = useQuery({
    queryKey: ['games', 'select'],
    queryFn: async () => pickArray<Game>((await api.get('/games')).data, 'games'),
    staleTime: 60_000,
  });

  const waitlist = useQuery({
    queryKey: ['waitlist', gameId],
    enabled: !!gameId,
    queryFn: async () =>
      pickArray<WaitlistEntry>((await api.get('/waitlist', { params: { gameId: Number(gameId) } })).data, 'waitlist', 'entries'),
  });

  const columns: Column<WaitlistEntry>[] = [
    { key: 'pos', header: 'Position', align: 'right', render: (w) => w.position },
    { key: 'req', header: 'Request', render: (w) => `#${w.requestId}` },
    { key: 'reason', header: 'Reason', render: (w) => w.reason ?? <span className="text-slate-400">—</span> },
    { key: 'status', header: 'Status', render: (w) => <Badge status={w.status} /> },
  ];

  return (
    <div>
      <PageHeader title="Waitlist" subtitle="Requests queued when inventory runs short for a game." />

      <div className="mb-4">
        <Field className="w-72" label="Game">
          <Select value={gameId} onChange={(e) => setGameId(e.target.value)}>
            <option value="">Select a game…</option>
            {games.data?.map((g) => (
              <option key={g.id} value={g.id}>
                #{g.id} · vs {g.opponent}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {!gameId ? (
        <EmptyState title="Select a game" description="Choose a game to view its waitlist." />
      ) : (
        <QueryState isLoading={waitlist.isLoading} error={waitlist.error}>
          <DataTable columns={columns} rows={waitlist.data} keyFn={(w) => w.id} emptyTitle="Waitlist is empty" />
        </QueryState>
      )}
    </div>
  );
}
