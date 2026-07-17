import { useEffect, useState } from 'react';
import { Cr9cd_contact_beneficiariesService } from '../generated/services/Cr9cd_contact_beneficiariesService';
import type { Cr9cd_contact_beneficiaries } from '../generated/models/Cr9cd_contact_beneficiariesModel';
import { escapeODataString } from '../dataverse/bind';
import { contactTypeChoice, valueTierChoice } from '../dataverse/choiceMaps';
import type { ContactType, ValueTier } from '../domain/enums';
import { TextInput, Select } from './Field';
import { Button } from './Button';
import { Spinner } from './Spinner';

export interface ContactSelection {
  id: string;
  name: string;
  type: ContactType;
}

// Search-and-select over the Contacts table (cr9cd_contact_beneficiary) -- contacts ARE the
// requestors, so this is the required way to attach a requestor to a ticket request. Falls back
// to an inline quick-create for a contact who isn't in the system yet.
export default function ContactPicker({ onSelect }: { onSelect: (selection: ContactSelection) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Cr9cd_contact_beneficiaries[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(() => {
      setLoading(true);
      Cr9cd_contact_beneficiariesService.getAll({
        filter: `contains(cr9cd_name, '${escapeODataString(query)}')`,
        top: 10,
        orderBy: ['cr9cd_name asc'],
      })
        .then((r) => setResults(r.data ?? []))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  function pick(c: Cr9cd_contact_beneficiaries) {
    onSelect({
      id: c.cr9cd_contact_beneficiaryid,
      name: c.cr9cd_name ?? '',
      type: c.cr9cd_type != null ? contactTypeChoice.toValue(c.cr9cd_type) : 'customer',
    });
  }

  if (showNewForm) {
    return (
      <NewContactInline
        onCancel={() => setShowNewForm(false)}
        onCreated={(c) => {
          setShowNewForm(false);
          pick(c);
        }}
      />
    );
  }

  return (
    <div className="relative mb-3">
      <div className="flex items-center gap-2">
        <TextInput placeholder="Search requestor by name…" value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1" />
        <Button size="sm" variant="secondary" onClick={() => setShowNewForm(true)}>
          New contact
        </Button>
      </div>
      {loading && (
        <div className="mt-1">
          <Spinner size="sm" label="Searching…" />
        </div>
      )}
      {results.length > 0 && (
        <ul className="card absolute z-10 mt-1 w-full divide-y divide-slate-100 py-1">
          {results.map((c) => (
            <li
              key={c.cr9cd_contact_beneficiaryid}
              className="cursor-pointer px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => pick(c)}
            >
              {c.cr9cd_name} {c.cr9cd_company ? <span className="text-slate-400">— {c.cr9cd_company}</span> : ''}
            </li>
          ))}
        </ul>
      )}
      {!loading && query.trim().length >= 2 && results.length === 0 && (
        <p className="mt-1 text-xs text-slate-400">No matching contacts. Try "New contact".</p>
      )}
    </div>
  );
}

function NewContactInline({
  onCreated,
  onCancel,
}: {
  onCreated: (c: Cr9cd_contact_beneficiaries) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ContactType>('customer');
  const [tier, setTier] = useState<ValueTier>('prospect');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const created = await Cr9cd_contact_beneficiariesService.create({
        cr9cd_name: name,
        cr9cd_type: contactTypeChoice.toCode(type),
        cr9cd_value_tier: valueTierChoice.toCode(tier),
        cr9cd_company: company,
      } as Parameters<typeof Cr9cd_contact_beneficiariesService.create>[0]);
      if (created.data) onCreated(created.data);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-3 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TextInput placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
        <Select value={type} onChange={(e) => setType(e.target.value as ContactType)} className="w-auto">
          <option value="customer">Customer</option>
          <option value="employee">Employee</option>
        </Select>
        <Select value={tier} onChange={(e) => setTier(e.target.value as ValueTier)} className="w-auto">
          <option value="platinum">Platinum</option>
          <option value="gold">Gold</option>
          <option value="silver">Silver</option>
          <option value="bronze">Bronze</option>
          <option value="prospect">Prospect</option>
        </Select>
        <TextInput placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} className="w-auto" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} loading={busy} onClick={create}>
          Create &amp; use
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
