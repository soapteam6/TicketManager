import { useEffect, useState, useCallback } from 'react';
import clsx from 'clsx';
import { Cr9cd_contact_beneficiariesService } from '../generated/services/Cr9cd_contact_beneficiariesService';
import { Cr9cd_attendancerecordsService } from '../generated/services/Cr9cd_attendancerecordsService';
import { Cr9cd_ticketrequestsService } from '../generated/services/Cr9cd_ticketrequestsService';
import type { Cr9cd_contact_beneficiaries } from '../generated/models/Cr9cd_contact_beneficiariesModel';
import { contactTypeChoice, valueTierChoice, ticketStatusChoice, requestStatusChoice } from '../dataverse/choiceMaps';
import type { ContactType, ValueTier } from '../domain/enums';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { Field, TextInput, Select } from '../components/Field';
import { Modal } from '../components/Modal';
import { formatUsd } from '../lib/format';

function NewContactForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ContactType>('customer');
  const [tier, setTier] = useState<ValueTier>('prospect');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await Cr9cd_contact_beneficiariesService.create({
        cr9cd_name: name,
        cr9cd_type: contactTypeChoice.toCode(type),
        cr9cd_value_tier: valueTierChoice.toCode(tier),
        cr9cd_company: company,
        cr9cd_email: email,
      } as Parameters<typeof Cr9cd_contact_beneficiariesService.create>[0]);
      setName('');
      setCompany('');
      setEmail('');
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <TextInput placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
      <Select value={type} onChange={(e) => setType(e.target.value as ContactType)}>
        <option value="customer">Customer</option>
        <option value="employee">Employee</option>
      </Select>
      <Select value={tier} onChange={(e) => setTier(e.target.value as ValueTier)}>
        <option value="platinum">Platinum</option>
        <option value="gold">Gold</option>
        <option value="silver">Silver</option>
        <option value="bronze">Bronze</option>
        <option value="prospect">Prospect</option>
      </Select>
      <TextInput placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
      <div className="flex gap-2">
        <TextInput placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button disabled={busy} loading={busy} onClick={create}>
          Add
        </Button>
      </div>
    </div>
  );
}

function EditContactFields({
  contact,
  onClose,
  onSaved,
}: {
  contact: Cr9cd_contact_beneficiaries;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(contact.cr9cd_name ?? '');
  const [type, setType] = useState<ContactType>(contact.cr9cd_type != null ? contactTypeChoice.toValue(contact.cr9cd_type) : 'customer');
  const [tier, setTier] = useState<ValueTier>(contact.cr9cd_value_tier != null ? valueTierChoice.toValue(contact.cr9cd_value_tier) : 'prospect');
  const [company, setCompany] = useState(contact.cr9cd_company ?? '');
  const [email, setEmail] = useState(contact.cr9cd_email ?? '');
  const [phone, setPhone] = useState(contact.cr9cd_phone ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await Cr9cd_contact_beneficiariesService.update(contact.cr9cd_contact_beneficiaryid, {
        cr9cd_name: name,
        cr9cd_type: contactTypeChoice.toCode(type),
        cr9cd_value_tier: valueTierChoice.toCode(tier),
        cr9cd_company: company,
        cr9cd_email: email,
        cr9cd_phone: phone,
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as ContactType)}>
            <option value="customer">Customer</option>
            <option value="employee">Employee</option>
          </Select>
        </Field>
        <Field label="Tier">
          <Select value={tier} onChange={(e) => setTier(e.target.value as ValueTier)}>
            <option value="platinum">Platinum</option>
            <option value="gold">Gold</option>
            <option value="silver">Silver</option>
            <option value="bronze">Bronze</option>
            <option value="prospect">Prospect</option>
          </Select>
        </Field>
        <Field label="Company">
          <TextInput value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" />
        </Field>
        <Field label="Email">
          <TextInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        </Field>
        <Field label="Phone">
          <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
        </Field>
      </div>
      <div className="-mx-6 mt-5 flex items-center justify-end gap-2 border-t border-slate-200 px-6 pt-4">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy} loading={busy} onClick={save}>
          Save
        </Button>
      </div>
    </>
  );
}

function EditContactModal({
  contact,
  onClose,
  onSaved,
}: {
  contact: Cr9cd_contact_beneficiaries | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Modal open={contact != null} onClose={onClose} title="Edit contact" size="lg">
      {contact && <EditContactFields contact={contact} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function ContactHistory({ contact }: { contact: Cr9cd_contact_beneficiaries }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attendance, setAttendance] = useState<Array<{ id: string; game: string; status: string; businessGenerated: number }>>([]);
  const [requests, setRequests] = useState<Array<{ id: string; game: string; status: string; quantity: number }>>([]);

  async function openHistory() {
    setOpen(true);
    setLoading(true);
    try {
      const [attendanceResult, requestsResult] = await Promise.all([
        Cr9cd_attendancerecordsService.getAll({ filter: `_cr9cd_beneficiary_contact_value eq ${contact.cr9cd_contact_beneficiaryid}` }),
        Cr9cd_ticketrequestsService.getAll({ filter: `_cr9cd_beneficiary_contact_value eq ${contact.cr9cd_contact_beneficiaryid}` }),
      ]);
      setAttendance(
        (attendanceResult.data ?? []).map((a) => ({
          id: a.cr9cd_attendancerecordid,
          game: a.cr9cd_gamename ?? '',
          status: a.cr9cd_ticket_status != null ? ticketStatusChoice.toValue(a.cr9cd_ticket_status) : '',
          businessGenerated: a.cr9cd_business_generated ?? 0,
        }))
      );
      setRequests(
        (requestsResult.data ?? []).map((r) => ({
          id: r.cr9cd_ticketrequestid,
          game: r.cr9cd_gamename ?? '',
          status: r.cr9cd_status != null ? requestStatusChoice.toValue(r.cr9cd_status) : 'submitted',
          quantity: r.cr9cd_quantity ?? 1,
        }))
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button className="text-xs font-medium text-brand-600 hover:text-brand-700" onClick={openHistory}>
        History
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`History — ${contact.cr9cd_name ?? ''}`}
        size="md"
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        {loading ? (
          <div className="py-6 text-center text-sm text-slate-400">Loading…</div>
        ) : (
          <>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Requests</h4>
            <ul className="mb-4 space-y-1 text-sm text-slate-700">
              {requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{r.game || '(game)'} — qty {r.quantity}</span>
                  <Badge status={r.status} />
                </li>
              ))}
              {requests.length === 0 && <li className="text-slate-400">None</li>}
            </ul>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Attendance</h4>
            <ul className="space-y-1 text-sm text-slate-700">
              {attendance.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {a.game || '(game)'} — {formatUsd(a.businessGenerated)}
                  </span>
                  <Badge status={a.status} />
                </li>
              ))}
              {attendance.length === 0 && <li className="text-slate-400">None</li>}
            </ul>
          </>
        )}
      </Modal>
    </>
  );
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Cr9cd_contact_beneficiaries[]>([]);
  const [typeFilter, setTypeFilter] = useState<'' | ContactType>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const filter = typeFilter ? `cr9cd_type eq ${contactTypeChoice.toCode(typeFilter)}` : undefined;
    const result = await Cr9cd_contact_beneficiariesService.getAll({ filter, orderBy: ['cr9cd_name asc'] });
    setContacts(result.data ?? []);
  }, [typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const editingContact = contacts.find((c) => c.cr9cd_contact_beneficiaryid === editingId) ?? null;

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Customers and employees eligible for ticket requests"
        actions={
          <Field label="Filter" className="w-40">
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as '' | ContactType)}>
              <option value="">All</option>
              <option value="customer">Customer</option>
              <option value="employee">Employee</option>
            </Select>
          </Field>
        }
      />

      <div className="card p-5">
        <NewContactForm onCreated={load} />

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['Name', 'Type', 'Tier', 'Company', 'Lifetime $', 'Attended', 'No-shows', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contacts.map((c) => (
                <tr key={c.cr9cd_contact_beneficiaryid} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{c.cr9cd_name}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge status={c.cr9cd_type != null ? contactTypeChoice.toValue(c.cr9cd_type) : undefined} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge status={c.cr9cd_value_tier != null ? valueTierChoice.toValue(c.cr9cd_value_tier) : undefined} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{c.cr9cd_company}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{formatUsd(c.cr9cd_lifetime_business_generated)}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{c.cr9cd_attended_count ?? 0}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{c.cr9cd_no_show_count ?? 0}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <ContactHistory contact={c} />
                      <button className="text-xs font-medium text-slate-500 hover:text-slate-700" onClick={() => setEditingId(c.cr9cd_contact_beneficiaryid)}>
                        Edit
                      </button>
                      <button
                        className={clsx('text-xs font-medium text-rose-500 hover:text-rose-700', busyId === c.cr9cd_contact_beneficiaryid && 'opacity-50')}
                        disabled={busyId === c.cr9cd_contact_beneficiaryid}
                        onClick={async () => {
                          if (!window.confirm(`Delete contact "${c.cr9cd_name}"? This cannot be undone.`)) return;
                          setBusyId(c.cr9cd_contact_beneficiaryid);
                          try {
                            await Cr9cd_contact_beneficiariesService.delete(c.cr9cd_contact_beneficiaryid);
                            await load();
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">
                    No contacts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <EditContactModal
        contact={editingContact}
        onClose={() => setEditingId(null)}
        onSaved={() => {
          setEditingId(null);
          load();
        }}
      />
    </div>
  );
}
