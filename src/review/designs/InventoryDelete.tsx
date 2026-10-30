import { useState } from 'react';
import { useReview } from '../context';
import { Button } from '../ui';

export function InventoryDelete({ kind, id, onDeleted }: {
  kind: 'team' | 'season' | 'game'; id: string; onDeleted: () => void;
}) {
  const { snapshot, run, busy } = useReview();
  const [confirming, setConfirming] = useState(false);
  const [cancelAllocations, setCancelAllocations] = useState(false);
  const team = kind === 'team' ? snapshot.teams.find(t => t.id === id) : undefined;
  const seasons = snapshot.seasons.filter(s => kind === 'team' ? s.teamId === id : kind === 'season' && s.id === id);
  const seasonIds = new Set(seasons.map(s => s.id));
  const games = snapshot.catalog.filter(g => kind === 'game' ? g.id === id : !!g.seasonId && seasonIds.has(g.seasonId));
  const ids = new Set(games.map(g => g.id));
  const allocations = (snapshot.allocations ?? []).filter(a => ids.has(a.gameId) && a.status !== 'cancelled');
  const transferred = allocations.filter(a => a.status === 'transferred').length;
  const requests = snapshot.requests.filter(r => ids.has(r.gameId) && r.status !== 'cancelled');
  const name = team?.name ?? (kind === 'season' ? seasons[0]?.label : games[0]?.title);
  const label = kind === 'game' && games[0]?.kind === 'event' ? 'event' : kind;
  const inventoryLabel = kind === 'game' ? label : 'game';
  const tickets = games.reduce((sum, game) => sum + game.totalTickets, 0);
  if (!name || snapshot.persona.role !== 'coordinator') return null;
  return <section className="work-event-remove" aria-label={`Delete ${label}`}>
    {confirming ? <div className="space-y-3">
        <p>Delete <strong>{name}</strong>{kind !== 'game' ? ' and its contents' : ''}?</p>
        <p className="text-sm">{kind === 'team' && `${seasons.length} ${seasons.length === 1 ? 'season' : 'seasons'} · `}{games.length} {inventoryLabel}{games.length !== 1 && 's'} · {tickets} {tickets === 1 ? 'ticket' : 'tickets'}</p>
        {requests.length > 0 && <p className="text-sm">Closes {requests.length} {requests.length === 1 ? 'request' : 'requests'}. Request and attendance history will be retained.</p>}
        {allocations.length > 0 && <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm"><p>{allocations.length} active {allocations.length === 1 ? 'allocation' : 'allocations'}{transferred > 0 && `, including ${transferred} already transferred`}. Cancellation only updates this app; it does not reverse a ticket-provider transfer.</p><label className="flex items-start gap-2"><input type="checkbox" name="cancelAllocations" checked={cancelAllocations} onChange={e => setCancelAllocations(e.target.checked)} className="mt-1" />Cancel these allocations too</label></div>}
        <p className="work-help">These items will leave inventory. Their names, dates and existing records stay available in history.</p>
        <div className="flex flex-wrap gap-2"><Button variant="danger" disabled={busy || allocations.length > 0 && !cancelAllocations} onClick={async () => {
          const command = kind === 'team' ? { type: 'removeTeam' as const, teamId: id, cancelAllocations } : kind === 'season' ? { type: 'removeSeason' as const, seasonId: id, cancelAllocations } : { type: 'removeInventory' as const, gameId: id, cancelAllocations };
          if (await run(command)) { setConfirming(false); onDeleted(); }
        }}>Confirm deletion</Button><Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep {label}</Button></div>
      </div> : <Button variant="danger" disabled={busy} onClick={() => { setCancelAllocations(false); setConfirming(true); }}>Delete {label}</Button>}
  </section>;
}
