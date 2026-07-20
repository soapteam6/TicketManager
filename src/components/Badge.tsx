import clsx from 'clsx';
import type { ReactNode } from 'react';
import { titleCase } from '../lib/format';

export type BadgeTone = 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'teal' | 'zinc';

const TONES: Record<BadgeTone, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-brand-50 text-brand-700 ring-brand-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200',
  zinc: 'bg-zinc-100 text-zinc-600 ring-zinc-200',
};

// Semantic mapping for known status strings across the domain enums.
const STATUS_TONE: Record<string, BadgeTone> = {
  // request status
  submitted: 'slate',
  scored: 'blue',
  recommended: 'violet',
  approved: 'green',
  partially_fulfilled: 'amber',
  fulfilled: 'green',
  waitlisted: 'amber',
  declined: 'red',
  cancelled: 'zinc',
  // game status
  scheduled: 'blue',
  transfer_pending: 'amber',
  completed: 'green',
  // seat status
  available: 'green',
  held: 'amber',
  assigned: 'blue',
  transferred: 'teal',
  // assignment status
  proposed: 'violet',
  // waitlist
  active: 'red',
  promoted: 'green',
  expired: 'zinc',
  // season status
  draft: 'slate',
  archived: 'zinc',
  // ticket status
  attended: 'green',
  accepted: 'blue',
  no_show: 'red',
  // future priority
  elevated: 'green',
  normal: 'slate',
  deprioritized: 'zinc',
  // value tier
  platinum: 'violet',
  gold: 'amber',
  silver: 'slate',
  bronze: 'zinc',
  prospect: 'blue',
  // integration status
  success: 'green',
  error: 'red',
  skipped: 'zinc',
  // contact type
  customer: 'blue',
  employee: 'slate',
};

export function Badge({
  children,
  tone,
  status,
  className,
}: {
  children?: ReactNode;
  tone?: BadgeTone;
  status?: string;
  className?: string;
}) {
  const resolvedTone: BadgeTone = tone ?? (status ? STATUS_TONE[status] ?? 'slate' : 'slate');
  const label = children ?? (status ? titleCase(status) : '');
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONES[resolvedTone],
        className
      )}
    >
      {label}
    </span>
  );
}
