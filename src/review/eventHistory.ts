import type { ReviewSnapshot } from './types';

export function findEvent(snapshot: ReviewSnapshot, id: string) {
  return snapshot.catalog.find(game => game.id === id) ?? snapshot.historyCatalog?.find(game => game.id === id);
}

export function requestEvents(snapshot: ReviewSnapshot) {
  return [...snapshot.catalog, ...(snapshot.historyCatalog ?? [])];
}
