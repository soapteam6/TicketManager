const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

// Check calendar components before parsing: Date.parse normalizes dates such as February 30.
export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

// API instants require seconds and an explicit Z or ±HH:MM offset; precision is milliseconds.
export function parseIsoTimestamp(value: string): number | null {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match || !isCalendarDate(match[1])) return null;
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59)
    return null;
  const zone = match[6];
  if (
    zone !== 'Z' &&
    (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)
  )
    return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// Native datetime-local controls omit a zone. These explicitly UTC-labelled controls treat
// their wall time as UTC. Read their submitted DOM value, rather than stale React state.
export function utcDateTimeInputToIso(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)
  ) {
    throw new Error('Enter a complete, valid date and time in UTC');
  }
  const iso = `${value.length === 16 ? `${value}:00` : value}Z`;
  if (parseIsoTimestamp(iso) === null)
    throw new Error('Enter a complete, valid date and time in UTC');
  return iso;
}
