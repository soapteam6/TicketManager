import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Game, WaitlistEntry } from '@/lib/types';
import { pickArray } from '@/lib/unwrap';
import { PageHeader } from '@/components/PageHeader';
import { QueryState, ErrorNote } from '@/components/QueryState';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Field, Select } from '@/components/Field';
import { RoleGate } from '@/auth/AuthContext';

export function WaitlistPage() {
  const qc = useQueryClient();
  const [gameId, setGameId] = useState('');

  const games = useQuery({
    queryKey: ['games', 'select'],
    queryFn: async () => pickArray<Game>((await api.get('/games')).data, 'games'),
    staleTime: 60_000,
  });

  const waitlist = useQuery({
    queryKey: ['waitlist', gameId || 'all'],
    queryFn: async () =>
      pickArray<WaitlistEntry>(
        (await api.get('/waitlist', { params: gameId ? { gameId: Number(gameId) } : undefined })).data,
        'waitlist',
        'entries'
      ),
  });

  const restore = useMutation({
    mutationFn: async (entryId: number) => (await api.post(`/waitlist/${entryId}/restore`, {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['waitlist'] });
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: ['game'] });
    },
  });

  const columns: Column<WaitlistEntry>[] = [
    {
      key: 'game',
      header: 'Game',
      render: (w) => (
        <Link to={`/games/${w.gameId}`} className="text-brand-700 hover:underline">
          {w.gameKind === 'event' ? w.gameTitle ?? `Game #${w.gameId}` : w.opponent ?? `Game #${w.gameId}`}
        </Link>
      ),
    },
    { key: 'pos', header: 'Position', align: 'right', render: (w) => w.position },
    { key: 'req', header: 'Request', render: (w) => w.requesterName ?? `#${w.requestId}` },
    { key: 'qty', header: 'Qty', align: 'right', render: (w) => w.quantity ?? '—' },
    { key: 'reason', header: 'Reason', render: (w) => w.reason ?? <span className="text-slate-400">—</span> },
    { key: 'status', header: 'Status', render: (w) => <Badge status={w.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (w) =>
        w.status === 'active' ? (
          <RoleGate roles={['admin']}>
            <Button
              size="sm"
              variant="secondary"
              loading={restore.isPending && restore.variables === w.id}
              onClick={() => restore.mutate(w.id)}
            >
              Promote to request
            </Button>
          </RoleGate>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title="Waitlist" subtitle="Requests queued when inventory runs short for a game." />

      <div className="mb-4">
        <Field className="w-72" label="Game">
          <Select value={gameId} onChange={(e) => setGameId(e.target.value)}>
            <option value="">All games</option>
            {games.data?.map((g) => (
              <option key={g.id} value={g.id}>
                #{g.id} · vs {g.opponent}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <ErrorNote error={restore.error} />
      <QueryState isLoading={waitlist.isLoading} error={waitlist.error}>
        <DataTable columns={columns} rows={waitlist.data} keyFn={(w) => w.id} emptyTitle="Waitlist is empty" />
      </QueryState>
    </div>
  );
}
