import { describe, expect, it } from 'vitest';
import { createFixtures, GUID } from './fixtures';
import { MockReviewProvider } from './provider';
import { activityDate, seasonIsActive, withSeasonActivity } from './seasonActivity';
import { inventoryHierarchy } from './inventoryNavigation';

const snapshot = () => new MockReviewProvider(() => Date.parse('2026-10-26T12:00:00Z')).snapshot('coordinator');
describe('automatic team and season activity', () => {
  it('keeps the end date inclusive and includes future seasons', () => {
    expect(seasonIsActive('2026-10-26', '2026-10-26')).toBe(true);
    expect(seasonIsActive('2026-10-25', '2026-10-26')).toBe(false);
    expect(seasonIsActive('2028-06-30', '2026-10-26')).toBe(true);
  });
  it('marks empty teams and teams with only finished seasons inactive', () => {
    const value = snapshot();
    value.teams.push({ id: 'empty', name: 'No seasons', defaultTickets: 4 });
    value.seasons = value.seasons.map(s => ({ ...s, endDate: '2026-01-01' }));
    const result = withSeasonActivity(value);
    expect(result.teams.every(t => t.active === false)).toBe(true);
    expect(result.seasons.every(s => s.active === false)).toBe(true);
  });
  it('automatically reactivates a team when a future season is created', () => {
    const value = snapshot(); value.seasons = [];
    expect(withSeasonActivity(value).teams[0].active).toBe(false);
    value.seasons.push({ id: 'future', teamId: value.teams[0].id, label: 'Next season', startDate: '2027-01-01', endDate: '2027-12-31' });
    expect(withSeasonActivity(value).teams[0].active).toBe(true);
  });
  it('retains all records and historical inventory without mutating saved data', () => {
    const value = snapshot(), before = structuredClone(value);
    const result = withSeasonActivity(value);
    expect(result.seasons.find(s => s.id === GUID(3, 2))?.active).toBe(false);
    expect(result.catalog).toEqual(value.catalog);
    expect(result.seasons).toHaveLength(value.seasons.length);
    expect(value).toEqual(before);
  });
  it('uses local calendar dates at the supplied server instant', () => {
    const value = snapshot(); value.serverNow = '2026-10-27T00:30:00Z';
    const local = new Date(value.serverNow);
    expect(activityDate(value)).toBe(`${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`);
  });
  it('gives requesters activity only for visible event groups', () => {
    const value = new MockReviewProvider(() => Date.parse('2026-10-26T12:00:00Z'), undefined, createFixtures()).snapshot('employee');
    value.catalog[0].seasonEndDate = '2026-10-01';
    const hierarchy = inventoryHierarchy(value);
    expect(hierarchy.teams).toHaveLength(1);
    expect(hierarchy.teams[0].active).toBe(false);
    expect(hierarchy.seasons[0].active).toBe(false);
  });
});
