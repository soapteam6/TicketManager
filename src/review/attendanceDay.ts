export const ATTENDANCE_TIME_ZONE = 'America/Los_Angeles';

export function attendanceDay(instant: string | number): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ATTENDANCE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (key: string) => parts.find(p => p.type === key)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function attendanceIsOpen(gameDate: string, now: string | number): boolean {
  const eventDay = attendanceDay(gameDate), today = attendanceDay(now);
  return !!eventDay && !!today && today >= eventDay;
}
