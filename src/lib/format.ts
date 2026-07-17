// Dataverse date/datetime columns always come back as ISO strings.
export function toDate(value: string | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat().format(value);
}

export function formatScore(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toFixed(3);
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Convert an ISO date/datetime string to a YYYY-MM-DD string for date inputs.
export function toDateInput(value: string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

// Pair for date-only fields (no time-of-day, e.g. season start/end date) that round-trip through
// a <input type="date">. `new Date("2026-07-18")` parses as UTC midnight, so a plain
// `.toISOString()`/`.toLocaleDateString()` round-trip shifts a day in any timezone behind UTC.
// Storing as LOCAL midnight instead, and reading back via local (not UTC) getters, keeps the
// calendar date the user picked stable regardless of timezone offset direction.
export function dateOnlyToIso(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

export function isoToDateOnlyInput(value: string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Display a date-only ISO value using local calendar components (pairs with dateOnlyToIso) so it
// doesn't fall back a day in timezones behind UTC the way `new Date(iso).toLocaleDateString()` can.
export function formatDateOnly(value: string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toLocaleDateString();
}
