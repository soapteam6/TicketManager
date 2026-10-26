import { createContext, useContext } from 'react';
import type {
  ReviewCommand,
  ReviewProvider,
  ReviewSnapshot,
  PersonaKey,
} from './types';
export interface ReviewContextValue {
  provider: ReviewProvider;
  snapshot: ReviewSnapshot;
  persona: PersonaKey;
  busy: boolean;
  error: string;
  run(command: ReviewCommand | (() => ReviewCommand)): Promise<boolean>;
}
export const ReviewContext = createContext<ReviewContextValue | null>(null);
export function useReview() {
  const ctx = useContext(ReviewContext);
  if (!ctx) throw new Error('Review context missing');
  return ctx;
}
