import { MockReviewProvider } from './provider';
let demoNow = Date.parse('2026-10-26T12:00:00Z');
export const getDemoNow = () => demoNow;
export function setDemoNow(now: number) {
  demoNow = now;
}
// One ephemeral fixture store per browser tab, never persisted or connected to the SDK.
export const demoProvider = new MockReviewProvider(getDemoNow);
