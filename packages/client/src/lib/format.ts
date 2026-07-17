// Server timestamps are unix-ms integers; some endpoints emit ISO strings.
export function toDate(value: number | string | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: number | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: number | string | null | undefined): string {
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
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Convert a Date to a YYYY-MM-DD string for date inputs.
export function toDateInput(value: number | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}
