import { isCalendarDate } from './dates';
import type { ReviewSnapshot } from './types';

export function activityDate(snapshot: ReviewSnapshot): string {
  const now = new Date(snapshot.serverNow ?? Date.now());
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Calendar end dates are inclusive in the viewer's local timezone. Upcoming
// seasons count as active too. No background writes or scheduler are required.
export function seasonIsActive(endDate: string, today: string): boolean {
  return !isCalendarDate(endDate) || endDate >= today;
}

export function withSeasonActivity(snapshot: ReviewSnapshot): ReviewSnapshot {
  const today = activityDate(snapshot);
  const seasons = snapshot.seasons.map(season => ({ ...season, active: seasonIsActive(season.endDate, today) }));
  const activeTeams = new Set(seasons.filter(season => season.active).map(season => season.teamId));
  return { ...snapshot, seasons, teams: snapshot.teams.map(team => ({ ...team, active: activeTeams.has(team.id) })) };
}
