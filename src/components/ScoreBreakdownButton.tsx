import { useState } from 'react';
import type { Cr9cd_ticketrequests } from '../generated/models/Cr9cd_ticketrequestsModel';
import type { FactorContribution } from '../domain/scoring-types';
import { Modal } from './Modal';
import { Button } from './Button';
import { ScoreBreakdown } from './ScoreBreakdown';

// Parse the persisted cr9cd_scoring_breakdown JSON into factor contributions (tolerant of missing/bad data).
function parseScoreBreakdown(json: string | undefined | null): FactorContribution[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as FactorContribution[]) : [];
  } catch {
    return [];
  }
}

// An ⓘ button that opens a modal showing how each factor contributed to the score. Pure math — the
// numbers and labels are the exact output of the scoring engine (no AI). Renders nothing when there's
// no breakdown to show.
export function ScoreBreakdownButton({
  score,
  requesterName,
  breakdown,
}: {
  score: number;
  requesterName?: string | null;
  breakdown: FactorContribution[];
}) {
  const [open, setOpen] = useState(false);
  if (breakdown.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label="Show score breakdown"
        title="Score breakdown"
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-slate-400 transition hover:text-brand-600"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v4a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="Score breakdown"
          description={`${requesterName ?? 'Request'} · final score ${score.toFixed(3)}`}
          size="md"
          footer={
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          }
        >
          <ScoreBreakdown breakdown={breakdown} />
        </Modal>
      )}
    </>
  );
}

// Convenience: a request's persisted score value followed by the breakdown button. Use in table cells.
export function ScoreCell({ request }: { request: Cr9cd_ticketrequests }) {
  const score = request.cr9cd_priority_score;
  if (score == null) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="tabular-nums">{score.toFixed(3)}</span>
      <ScoreBreakdownButton
        score={score}
        requesterName={request.cr9cd_requester_name}
        breakdown={parseScoreBreakdown(request.cr9cd_scoring_breakdown)}
      />
    </span>
  );
}
