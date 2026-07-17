import clsx from 'clsx';
import type { FactorContribution } from '@ais/shared';

// Renders a request's factor contributions as labeled horizontal bars. The
// sharePct is a signed share of the total; we scale bar width against the
// largest absolute share so the strongest driver fills the track.
export function ScoreBreakdown({ breakdown }: { breakdown: FactorContribution[] }) {
  if (!breakdown || breakdown.length === 0) {
    return <p className="text-sm text-slate-400">No breakdown available.</p>;
  }

  const maxAbs = Math.max(1, ...breakdown.map((c) => Math.abs(c.sharePct)));

  return (
    <div className="space-y-3">
      {breakdown.map((c) => {
        const pct = c.sharePct;
        const width = `${(Math.abs(pct) / maxAbs) * 100}%`;
        const positive = pct >= 0;
        return (
          <div key={c.factor}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700">{c.label}</span>
              <span
                className={clsx(
                  'tabular-nums font-semibold',
                  positive ? 'text-emerald-600' : 'text-rose-600'
                )}
              >
                {positive ? '+' : ''}
                {pct.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={clsx('h-full rounded-full', positive ? 'bg-brand-500' : 'bg-rose-400')}
                style={{ width }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
              <span className="truncate pr-2">{c.explanation}</span>
              <span className="shrink-0 tabular-nums">
                w {c.weight.toFixed(2)} · n {c.normalizedValue.toFixed(2)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
