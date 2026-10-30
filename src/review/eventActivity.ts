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
  return { ...snapshot, catalog: snapshot.catalog
    .map(game => ({ ...game, status: eventStatus(game, now) }))
    .filter(game => coordinator || acceptsInterest(game, now)) };
}

export function advancingServerTime(serverNow: string, receivedAt: number, now: number): string {
  return new Date(Date.parse(serverNow) + Math.max(0, now - receivedAt)).toISOString();
}
