import type { Inventory, ReviewSnapshot } from './types';

export function eventStatus(game: Pick<Inventory, 'status' | 'gameDate'>, now: number): Inventory['status'] {
  return game.status === 'scheduled' && Date.parse(game.gameDate) <= now ? 'completed' : game.status;
}

export function acceptsInterest(game: Pick<Inventory, 'status' | 'gameDate' | 'removed'>, now: number): boolean {
  return !game.removed && game.status === 'scheduled' && Date.parse(game.gameDate) > now;
}

// Completed is derived from the event instant. Viewing history must not write
// records, rewrite attendance or compete with someone saving a request.
export function withEventActivity(snapshot: ReviewSnapshot): ReviewSnapshot {
  const now = Date.parse(snapshot.serverNow ?? new Date().toISOString());
  const coordinator = snapshot.persona.role === 'coordinator';
  const catalog = snapshot.catalog.map(game => ({ ...game, status: eventStatus(game, now) }));
  const historyCatalog = [...(snapshot.historyCatalog ?? []), ...catalog.filter(game => !coordinator && !acceptsInterest(game, now) && snapshot.requests.some(r => r.gameId === game.id))];
  return { ...snapshot, catalog: catalog.filter(game => !game.removed && (coordinator || acceptsInterest(game, now))), historyCatalog };
}

export function advancingServerTime(serverNow: string, receivedAt: number, now: number): string {
  return new Date(Date.parse(serverNow) + Math.max(0, now - receivedAt)).toISOString();
}
