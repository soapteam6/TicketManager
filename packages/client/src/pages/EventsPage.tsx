import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Game } from '@/lib/types';
import { pickArray } from '@/lib/unwrap';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState, ErrorNote } from '@/components/QueryState';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Field, TextInput, TextArea } from '@/components/Field';
import { RoleGate } from '@/auth/AuthContext';

// Custom events (title/description/date/tickets) — one-off ticketed events that aren't team games.
export function EventsPage() {
  const [showNew, setShowNew] = useState(false);

  const events = useQuery({
    queryKey: ['events'],
    queryFn: async () => pickArray<Game>((await api.get('/events')).data, 'events'),
  });

  const columns: Column<Game>[] = [
    {
      key: 'title',
      header: 'Event',
      render: (e) => (
        <div>
          <Link to={`/games/${e.id}`} className="font-medium text-brand-700 hover:underline">
            {e.title ?? e.opponent}
          </Link>
          {e.description && <div className="max-w-md truncate text-xs text-slate-400">{e.description}</div>}
        </div>
      ),
    },
    { key: 'date', header: 'Date & time', render: (e) => formatDateTime(e.gameDate) },
    { key: 'tickets', header: 'Tickets', align: 'right', render: (e) => e.totalSeats },
    { key: 'status', header: 'Status', render: (e) => <Badge status={e.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Events"
        subtitle="Custom, one-off ticketed events (not team games)."
        actions={
          <RoleGate roles={['admin']}>
            <Button onClick={() => setShowNew(true)}>New event</Button>
          </RoleGate>
        }
      />

      <QueryState isLoading={events.isLoading} error={events.error}>
        <DataTable
          columns={columns}
          rows={events.data}
          keyFn={(e) => e.id}
          emptyTitle="No events yet"
          emptyDescription="Create a custom event with a title, date, and number of tickets."
        />
      </QueryState>

      {showNew && <NewEventModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function NewEventModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [tickets, setTickets] = useState('0');

  const create = useMutation({
    mutationFn: async () =>
      (await api.post('/events', { title, description: description || undefined, date, tickets: Number(tickets) || 0 })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['games'] });
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="New event"
      description="A custom event with a title, description, date, and number of tickets."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={!title || !date} onClick={() => create.mutate()}>Create event</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" required>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Client Appreciation Night" required />
        </Field>
        <Field label="Description">
          <TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Suite for key accounts, catered…" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date & time" required>
            <TextInput type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Number of tickets" hint="Seats to create">
            <TextInput type="number" min="0" value={tickets} onChange={(e) => setTickets(e.target.value)} />
          </Field>
        </div>
        <ErrorNote error={create.error} />
      </div>
    </Modal>
  );
}
