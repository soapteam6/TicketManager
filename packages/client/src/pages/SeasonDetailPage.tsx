import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Game, Season } from '@/lib/types';
import { pickArray, pickObject } from '@/lib/unwrap';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState, ErrorNote } from '@/components/QueryState';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Field, TextInput, TextArea } from '@/components/Field';
import { RoleGate } from '@/auth/AuthContext';

// Parse "YYYY-MM-DD, Opponent, Promotions" lines into the import payload.
function parseScheduleLines(text: string) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [gameDate, opponent, ...rest] = line.split(',').map((p) => p.trim());
      return { gameDate, opponent: opponent ?? '', promotions: rest.join(', ') || undefined };
    })
    .filter((g) => g.gameDate && g.opponent);
}

export function SeasonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const seasonId = Number(id);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const detail = useQuery({
    queryKey: ['seasons', seasonId],
    queryFn: async () => {
      const data = (await api.get(`/seasons/${seasonId}`)).data;
      return {
        season: pickObject<Season>(data, 'season'),
        games: pickArray<Game>(data, 'games'),
      };
    },
  });

  const season = detail.data?.season;
  const qc = useQueryClient();

  const setStatus = useMutation({
    mutationFn: async (status: 'active' | 'completed') => (await api.patch(`/seasons/${seasonId}`, { status })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seasons', seasonId] });
      qc.invalidateQueries({ queryKey: ['games'] });
      qc.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const columns: Column<Game>[] = [
    { key: 'date', header: 'Date', render: (g) => formatDate(g.gameDate) },
    {
      key: 'opp',
      header: 'Opponent',
      render: (g) => (
        <Link to={`/games/${g.id}`} className="font-medium text-brand-700 hover:underline">
          vs {g.opponent}
        </Link>
      ),
    },
    { key: 'promo', header: 'Promotions', render: (g) => g.promotions || <span className="text-slate-400">—</span> },
    { key: 'seats', header: 'Seats', align: 'right', render: (g) => g.totalSeats },
    { key: 'premium', header: 'Premium', align: 'right', render: (g) => (g.premiumScore ?? 0).toFixed(2) },
    { key: 'status', header: 'Status', render: (g) => <Badge status={g.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title={season?.label ?? 'Season'}
        breadcrumbs={
          <Link to="/teams" className="hover:text-slate-700">
            Teams & Seasons
          </Link>
        }
        subtitle={season ? `${formatDate(season.startDate)} – ${formatDate(season.endDate)}` : undefined}
        actions={
          <>
            {season && <Badge status={season.status} />}
            <RoleGate roles={['admin']}>
              {season && season.status !== 'active' && (
                <Button variant="secondary" loading={setStatus.isPending && setStatus.variables === 'active'} onClick={() => setStatus.mutate('active')}>
                  Mark active
                </Button>
              )}
              {season && season.status !== 'completed' && (
                <Button variant="secondary" loading={setStatus.isPending && setStatus.variables === 'completed'} onClick={() => setStatus.mutate('completed')}>
                  Mark complete
                </Button>
              )}
              <Button variant="secondary" onClick={() => setShowImport(true)}>
                Import schedule
              </Button>
              <Button onClick={() => setShowAdd(true)}>Add game</Button>
            </RoleGate>
          </>
        }
      />

      <ErrorNote error={setStatus.error} />

      <QueryState isLoading={detail.isLoading} error={detail.error}>
        <DataTable
          columns={columns}
          rows={detail.data?.games}
          keyFn={(g) => g.id}
          emptyTitle="No games scheduled"
          emptyDescription="Add games individually or import a full schedule."
        />
      </QueryState>

      {showAdd && <AddGameModal seasonId={seasonId} onClose={() => setShowAdd(false)} />}
      {showImport && <ImportScheduleModal seasonId={seasonId} onClose={() => setShowImport(false)} />}
    </div>
  );
}

function AddGameModal({ seasonId, onClose }: { seasonId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [gameDate, setGameDate] = useState('');
  const [opponent, setOpponent] = useState('');
  const [promotions, setPromotions] = useState('');
  const [premiumScore, setPremiumScore] = useState('0.5');

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post('/games', {
          seasonId,
          gameDate,
          opponent,
          promotions: promotions || undefined,
          premiumScore: Number(premiumScore),
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seasons', seasonId] });
      onClose();
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add game"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-game" loading={create.isPending}>Add game</Button>
        </>
      }
    >
      <form id="add-game" onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Game date" required>
            <TextInput type="date" value={gameDate} onChange={(e) => setGameDate(e.target.value)} required />
          </Field>
          <Field label="Premium score" hint="0.0 – 1.0">
            <TextInput type="number" step="0.05" min="0" max="1" value={premiumScore} onChange={(e) => setPremiumScore(e.target.value)} />
          </Field>
        </div>
        <Field label="Opponent" required>
          <TextInput value={opponent} onChange={(e) => setOpponent(e.target.value)} required />
        </Field>
        <Field label="Promotions">
          <TextInput value={promotions} onChange={(e) => setPromotions(e.target.value)} placeholder="Fireworks Night" />
        </Field>
        <ErrorNote error={create.error} />
      </form>
    </Modal>
  );
}

function ImportScheduleModal({ seasonId, onClose }: { seasonId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const parsed = parseScheduleLines(text);

  const importGames = useMutation({
    mutationFn: async () => (await api.post(`/seasons/${seasonId}/games/import`, { games: parsed })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seasons', seasonId] });
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Import schedule"
      description="Paste one game per line: YYYY-MM-DD, Opponent, Promotions (optional)."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={importGames.isPending} disabled={parsed.length === 0} onClick={() => importGames.mutate()}>
            Import {parsed.length || ''} game{parsed.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <TextArea
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'2025-10-14, Colorado Avalanche, Opening Night\n2025-10-18, San Jose Sharks'}
        className="font-mono text-xs"
      />
      {parsed.length > 0 && (
        <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Opponent</th>
                <th className="px-3 py-2 text-left">Promotions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parsed.map((g, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5">{g.gameDate}</td>
                  <td className="px-3 py-1.5">{g.opponent}</td>
                  <td className="px-3 py-1.5 text-slate-500">{g.promotions ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ErrorNote error={importGames.error} />
    </Modal>
  );
}
