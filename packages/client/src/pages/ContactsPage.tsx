import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONTACT_TYPE, VALUE_TIER, FUTURE_PRIORITY } from '@ais/shared';
import { api } from '@/lib/api';
import type { AttendanceRecord, Contact, TicketRequest } from '@/lib/types';
import { pickArray, pickObject } from '@/lib/unwrap';
import { formatDate, formatUsd } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState, ErrorNote } from '@/components/QueryState';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Modal, Drawer } from '@/components/Modal';
import { Field, TextInput, TextArea, Select, EnumOptions } from '@/components/Field';
import { RoleGate } from '@/auth/AuthContext';
import { EmptyState } from '@/components/EmptyState';

export function ContactsPage() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [historyFor, setHistoryFor] = useState<Contact | null>(null);

  const contacts = useQuery({
    queryKey: ['contacts', { q, type }],
    queryFn: async () => {
      const res = await api.get('/contacts', {
        params: { ...(q ? { q } : {}), ...(type ? { type } : {}) },
      });
      return pickArray<Contact>(res.data, 'contacts');
    },
  });

  const columns: Column<Contact>[] = [
    {
      key: 'name',
      header: 'Contact',
      render: (c) => (
        <div>
          <div className="font-medium text-slate-900">{c.fullName}</div>
          <div className="text-xs text-slate-400">{c.title ? `${c.title} · ` : ''}{c.company ?? ''}</div>
        </div>
      ),
    },
    { key: 'type', header: 'Type', render: (c) => <Badge tone="slate">{c.type}</Badge> },
    { key: 'tier', header: 'Tier', render: (c) => <Badge status={c.valueTier} /> },
    { key: 'att', header: 'Attended', align: 'right', render: (c) => `${c.attendedCount}/${c.awardedCount}` },
    { key: 'priority', header: 'Priority', render: (c) => <Badge status={c.futurePriorityFlag} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (c) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setHistoryFor(c); }}>History</Button>
          <RoleGate roles={['admin', 'sales_rep']}>
            <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setEditing(c); }}>Edit</Button>
          </RoleGate>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Customers and employees who receive tickets."
        actions={
          <RoleGate roles={['admin', 'sales_rep']}>
            <Button onClick={() => setEditing('new')}>New contact</Button>
          </RoleGate>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Field className="w-72">
          <TextInput placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field className="w-44">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <EnumOptions values={CONTACT_TYPE} includeBlank blankLabel="All types" />
          </Select>
        </Field>
      </div>

      <QueryState isLoading={contacts.isLoading} error={contacts.error}>
        <DataTable columns={columns} rows={contacts.data} keyFn={(c) => c.id} emptyTitle="No contacts found" />
      </QueryState>

      {editing && (
        <ContactModal contact={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {historyFor && <ContactHistoryDrawer contact={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function ContactModal({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!contact;
  const [type, setType] = useState(contact?.type ?? 'customer');
  const [fullName, setFullName] = useState(contact?.fullName ?? '');
  const [company, setCompany] = useState(contact?.company ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [title, setTitle] = useState(contact?.title ?? '');
  const [valueTier, setValueTier] = useState(contact?.valueTier ?? 'prospect');
  const [futurePriorityFlag, setFuturePriorityFlag] = useState(contact?.futurePriorityFlag ?? 'normal');
  const [notes, setNotes] = useState(contact?.notes ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const del = useMutation({
    mutationFn: async () => (await api.delete(`/contacts/${contact!.id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      onClose();
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        type,
        fullName,
        company: company || undefined,
        email: email || undefined,
        phone: phone || undefined,
        title: title || undefined,
        valueTier,
        notes: notes || undefined,
        ...(isEdit ? { futurePriorityFlag } : {}),
      };
      const res = isEdit
        ? await api.patch(`/contacts/${contact!.id}`, body)
        : await api.post('/contacts', body);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      onClose();
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit contact' : 'New contact'}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <div>
            {isEdit && (
              <RoleGate roles={['admin']}>
                {confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-rose-700">Delete this contact?</span>
                    <Button variant="danger" size="sm" loading={del.isPending} onClick={() => del.mutate()}>Confirm</Button>
                    <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                  </div>
                ) : (
                  <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
                )}
              </RoleGate>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="contact-form" loading={save.isPending}>Save</Button>
          </div>
        </div>
      }
    >
      <form id="contact-form" onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Full name" required>
            <TextInput value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </Field>
          <Field label="Type" required>
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <EnumOptions values={CONTACT_TYPE} />
            </Select>
          </Field>
          <Field label="Company">
            <TextInput value={company} onChange={(e) => setCompany(e.target.value)} />
          </Field>
          <Field label="Title">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone">
            <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Value tier">
            <Select value={valueTier} onChange={(e) => setValueTier(e.target.value as typeof valueTier)}>
              <EnumOptions values={VALUE_TIER} />
            </Select>
          </Field>
          {isEdit && (
            <Field label="Future priority">
              <Select value={futurePriorityFlag} onChange={(e) => setFuturePriorityFlag(e.target.value as typeof futurePriorityFlag)}>
                <EnumOptions values={FUTURE_PRIORITY} />
              </Select>
            </Field>
          )}
        </div>
        <Field label="Notes">
          <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorNote error={save.error || del.error} />
      </form>
    </Modal>
  );
}

function ContactHistoryDrawer({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const history = useQuery({
    queryKey: ['contacts', contact.id, 'history'],
    queryFn: async () => {
      const data = (await api.get(`/contacts/${contact.id}/history`)).data;
      return {
        attendance: pickArray<{ record: AttendanceRecord; opponent?: string; gameDate?: number }>(data, 'attendance'),
        requests: pickArray<TicketRequest>(data, 'requests'),
        contact: pickObject<Contact>(data, 'contact') ?? contact,
      };
    },
  });

  return (
    <Drawer open onClose={onClose} title={contact.fullName} description={contact.company ?? contact.type} size="lg">
      <QueryState isLoading={history.isLoading} error={history.error}>
        <div className="space-y-6">
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Attendance</h4>
            {history.data && history.data.attendance.length > 0 ? (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {history.data.attendance.map((a) => (
                  <div key={a.record.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <div className="font-medium text-slate-800">vs {a.opponent ?? '—'}</div>
                      <div className="text-xs text-slate-400">{formatDate(a.gameDate)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">{formatUsd(a.record.businessGenerated)}</span>
                      <Badge status={a.record.ticketStatus} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No attendance history" />
            )}
          </section>

          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Requests</h4>
            {history.data && history.data.requests.length > 0 ? (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {history.data.requests.map((r) => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <div className="font-medium text-slate-800">Game #{r.gameId}</div>
                      <div className="text-xs text-slate-400">Qty {r.quantity}</div>
                    </div>
                    <Badge status={r.status} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No request history" />
            )}
          </section>
        </div>
      </QueryState>
    </Drawer>
  );
}
