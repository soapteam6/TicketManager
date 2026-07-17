import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { GameRankingResult, RankedRequest } from '@ais/shared';
import { api } from '@/lib/api';
import { pickObject } from '@/lib/unwrap';
import { formatScore } from '@/lib/format';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { ScoreBreakdown } from '@/components/ScoreBreakdown';
import { ErrorNote } from '@/components/QueryState';
import { EmptyState } from '@/components/EmptyState';

// The server may return a GameRankingResult directly or wrapped under { ranking }.
// It may also attach a per-request `narrative` string.
type RankedWithNarrative = RankedRequest & { narrative?: string | null };

export function RankingPanel({ gameId, onScored }: { gameId: number; onScored?: () => void }) {
  const [result, setResult] = useState<GameRankingResult | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const score = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/games/${gameId}/requests/score`, {});
      return pickObject<GameRankingResult>(res.data, 'ranking', 'result') ?? (res.data as GameRankingResult);
    },
    onSuccess: (data) => {
      setResult(data);
      onScored?.();
    },
  });

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Priority ranking</h3>
          <p className="text-xs text-slate-500">Score all open requests against the active scoring config.</p>
        </div>
        <Button size="sm" loading={score.isPending} onClick={() => score.mutate()}>
          Score &amp; Rank
        </Button>
      </div>

      <ErrorNote error={score.error} />

      {result && (
        <div className="mt-4">
          <div className="mb-3 flex flex-wrap gap-2 text-xs text-slate-500">
            <span className="rounded-md bg-slate-100 px-2 py-1">
              Seats available: <b className="text-slate-700">{result.seatsAvailable}</b>
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-1">
              Remaining after awards: <b className="text-slate-700">{result.seatsRemaining}</b>
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-1">
              Config #{result.configId}
            </span>
          </div>

          {result.ranked.length === 0 ? (
            <EmptyState title="No requests to rank" description="Create requests for this game first." />
          ) : (
            <div className="space-y-2">
              {(result.ranked as RankedWithNarrative[]).map((r) => {
                const isOpen = expanded === r.requestId;
                return (
                  <div key={r.requestId} className="rounded-lg border border-slate-200">
                    <button
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                      onClick={() => setExpanded(isOpen ? null : r.requestId)}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                        {r.rank}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-slate-900">{r.requesterName}</span>
                          {r.contactType && <Badge tone="slate">{r.contactType}</Badge>}
                        </div>
                        <div className="text-xs text-slate-400">Qty {r.quantity}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums text-slate-800">{formatScore(r.finalScore)}</div>
                        <Badge status={r.recommendation === 'award' ? 'approved' : 'waitlisted'}>
                          {r.recommendation === 'award' ? 'Award' : 'Waitlist'}
                        </Badge>
                      </div>
                      <svg
                        className={`h-4 w-4 shrink-0 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                      </svg>
                    </button>

                    {isOpen && (
                      <div className="border-t border-slate-100 px-4 py-4">
                        {r.narrative && (
                          <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2">
                            <div className="mb-1 flex items-center gap-2">
                              <Badge tone="violet">AI</Badge>
                              <span className="text-xs font-medium text-slate-600">Narrative rationale</span>
                            </div>
                            <p className="text-sm leading-relaxed text-slate-700">{r.narrative}</p>
                          </div>
                        )}
                        <ScoreBreakdown breakdown={r.breakdown} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
