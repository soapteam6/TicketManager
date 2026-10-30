import { useState } from 'react';
import { useReview } from '../context';
import { Button } from '../ui';

export function InventoryDelete({ kind, id, onDeleted }: {
  kind: 'team' | 'season' | 'game'; id: string; onDeleted: () => void;
}) {
  const { snapshot, run, busy } = useReview();
  const [confirming, setConfirming] = useState(false);
  const team = kind === 'team' ? snapshot.teams.find(t => t.id === id) : undefined;
  const seasons = snapshot.seasons.filter(s => kind === 'team' ? s.teamId === id : kind === 'season' && s.id === id);
  const seasonIds = new Set(seasons.map(s => s.id));
  const games = snapshot.catalog.filter(g => kind === 'game' ? g.id === id : !!g.seasonId && seasonIds.has(g.seasonId));
  const ids = new Set(games.map(g => g.id));
  const hasHistory = snapshot.requests.some(r => ids.has(r.gameId)) || snapshot.allocations?.some(a => ids.has(a.gameId));
  const name = team?.name ?? (kind === 'season' ? seasons[0]?.label : games[0]?.title);
  const label = kind === 'game' && games[0]?.kind === 'event' ? 'event' : kind;
  const inventoryLabel = kind === 'game' ? label : 'game';
  const tickets = games.reduce((sum, game) => sum + game.totalTickets, 0);
  if (!name || snapshot.persona.role !== 'coordinator') return null;
  return <section className="work-event-remove" aria-label={`Delete ${label}`}>
    {hasHistory ? <><Button variant="danger" disabled>Delete {label}</Button><p className="work-help">Cannot delete: {kind === 'game' ? `this ${label} has` : 'an affected game has'} request or allocation history.</p></>
      : confirming ? <div className="space-y-3">
        <p>Delete <strong>{name}</strong>{kind !== 'game' ? ' and its contents' : ''}?</p>
        <p className="text-sm">{kind === 'team' && `${seasons.length} ${seasons.length === 1 ? 'season' : 'seasons'} · `}{games.length} {inventoryLabel}{games.length !== 1 && 's'} · {tickets} {tickets === 1 ? 'ticket' : 'tickets'}</p>
        <p className="work-help">These items will disappear from the app. Underlying records are retained.</p>
        <div className="flex flex-wrap gap-2"><Button variant="danger" disabled={busy} onClick={async () => {
          const command = kind === 'team' ? { type: 'removeTeam' as const, teamId: id } : kind === 'season' ? { type: 'removeSeason' as const, seasonId: id } : { type: 'removeInventory' as const, gameId: id };
          if (await run(command)) { setConfirming(false); onDeleted(); }
        }}>Confirm deletion</Button><Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep {label}</Button></div>
      </div> : <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>Delete {label}</Button>}
  </section>;
}
