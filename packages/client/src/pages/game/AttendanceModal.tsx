import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ATTENDANCE_OUTCOMES } from '@ais/shared';
import { api } from '@/lib/api';
import type { Assignment } from '@/lib/types';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { Field, TextArea } from '@/components/Field';
import { ErrorNote } from '@/components/QueryState';

const OUTCOME_LABELS: Record<(typeof ATTENDANCE_OUTCOMES)[number], string> = {
  attended: 'Attended',
  no_show: 'No-show',
  cancelled: 'Cancelled',
};

// Reconcile an assignment after the game: did the recipient attend, no-show, or cancel?
export function AttendanceModal({
  assignment,
  gameId,
  onClose,
}: {
  assignment: Assignment;
  gameId: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const initialOutcome = ATTENDANCE_OUTCOMES.includes(assignment.attendanceStatus as never)
    ? (assignment.attendanceStatus as string)
    : 'attended';
  const [ticketStatus, setTicketStatus] = useState<string>(initialOutcome);
  const [followUpNotes, setFollowUpNotes] = useState('');

  const record = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/assignments/${assignment.id}/attendance`, {
          ticketStatus,
          followUpNotes: followUpNotes || undefined,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['game', gameId] });
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      onClose();
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    record.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Record attendance"
      description={assignment.requesterName ?? `Assignment #${assignment.id}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="attendance" loading={record.isPending}>Save record</Button>
        </>
      }
    >
      <form id="attendance" onSubmit={onSubmit} className="space-y-4">
        <Field label="Outcome" required>
          <div className="flex flex-wrap gap-2">
            {ATTENDANCE_OUTCOMES.map((outcome) => {
              const on = ticketStatus === outcome;
              return (
                <button
                  key={outcome}
                  type="button"
                  onClick={() => setTicketStatus(outcome)}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                    on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-brand-400'
                  }`}
                >
                  {OUTCOME_LABELS[outcome]}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Notes">
          <TextArea rows={3} value={followUpNotes} onChange={(e) => setFollowUpNotes(e.target.value)} placeholder="Optional" />
        </Field>
        <ErrorNote error={record.error} />
      </form>
    </Modal>
  );
}
