import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TICKET_STATUS, CONTACT_TYPE, FUTURE_PRIORITY } from '@ais/shared';
import { api } from '@/lib/api';
import type { Assignment } from '@/lib/types';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { Field, Select, TextInput, TextArea, EnumOptions } from '@/components/Field';
import { ErrorNote } from '@/components/QueryState';

// Reconcile a transferred assignment: post attendance for the game.
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
  const [ticketStatus, setTicketStatus] = useState<string>('attended');
  const [designation, setDesignation] = useState<string>('customer');
  const [salesRepUserId, setSalesRepUserId] = useState('');
  const [businessGenerated, setBusinessGenerated] = useState('');
  const [futurePriority, setFuturePriority] = useState('normal');
  const [followUpNotes, setFollowUpNotes] = useState('');

  const record = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/assignments/${assignment.id}/attendance`, {
          ticketStatus,
          designation,
          salesRepUserId: salesRepUserId ? Number(salesRepUserId) : undefined,
          businessGenerated: businessGenerated ? Number(businessGenerated) : undefined,
          futurePriority,
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
      title="Reconcile attendance"
      description={`Assignment #${assignment.id}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="attendance" loading={record.isPending}>Save record</Button>
        </>
      }
    >
      <form id="attendance" onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Ticket status" required>
            <Select value={ticketStatus} onChange={(e) => setTicketStatus(e.target.value)}>
              <EnumOptions values={TICKET_STATUS} />
            </Select>
          </Field>
          <Field label="Designation" required>
            <Select value={designation} onChange={(e) => setDesignation(e.target.value)}>
              <EnumOptions values={CONTACT_TYPE} />
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Sales rep user ID">
            <TextInput type="number" value={salesRepUserId} onChange={(e) => setSalesRepUserId(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Business generated (USD)">
            <TextInput type="number" min="0" step="100" value={businessGenerated} onChange={(e) => setBusinessGenerated(e.target.value)} placeholder="0" />
          </Field>
        </div>
        <Field label="Future priority">
          <Select value={futurePriority} onChange={(e) => setFuturePriority(e.target.value)}>
            <EnumOptions values={FUTURE_PRIORITY} />
          </Select>
        </Field>
        <Field label="Follow-up notes">
          <TextArea rows={3} value={followUpNotes} onChange={(e) => setFollowUpNotes(e.target.value)} />
        </Field>
        <ErrorNote error={record.error} />
      </form>
    </Modal>
  );
}
