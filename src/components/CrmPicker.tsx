import { useEffect, useState } from 'react';
import { searchAccounts, listContactsForAccount } from '../services/crmService';
import type { CrmAccountSummary, CrmContactSummary } from '../services/crmService';
import { TextInput } from './Field';
import { Button } from './Button';
import { Spinner } from './Spinner';

export interface CrmSelection {
  account: CrmAccountSummary;
  contact: CrmContactSummary;
}

export default function CrmPicker({ onSelect }: { onSelect: (selection: CrmSelection) => void }) {
  const [query, setQuery] = useState('');
  const [accounts, setAccounts] = useState<CrmAccountSummary[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<CrmAccountSummary | null>(null);
  const [contacts, setContacts] = useState<CrmContactSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedAccount || query.trim().length < 2) {
      setAccounts([]);
      return;
    }
    const timeout = setTimeout(() => {
      setLoading(true);
      searchAccounts(query)
        .then(setAccounts)
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [query, selectedAccount]);

  async function pickAccount(account: CrmAccountSummary) {
    setSelectedAccount(account);
    setAccounts([]);
    setLoading(true);
    try {
      const result = await listContactsForAccount(account.id);
      setContacts(result);
    } finally {
      setLoading(false);
    }
  }

  if (selectedAccount) {
    return (
      <div className="card mb-3 p-4">
        <div className="mb-2 flex items-center gap-3">
          <strong className="text-sm text-slate-900">{selectedAccount.name}</strong>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedAccount(null);
              setContacts([]);
              setQuery('');
            }}
          >
            Change account
          </Button>
        </div>
        {loading && <Spinner size="sm" label="Loading contacts…" />}
        {!loading && contacts.length === 0 && <p className="text-sm text-slate-400">No contacts found for this account.</p>}
        <ul className="divide-y divide-slate-100">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-slate-700">
                {c.fullName} {c.title ? <span className="text-slate-400">— {c.title}</span> : ''}
              </span>
              <Button size="sm" variant="secondary" onClick={() => onSelect({ account: selectedAccount, contact: c })}>
                Use this contact
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="relative mb-3">
      <TextInput placeholder="Search CRM accounts by name…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {loading && (
        <div className="mt-1">
          <Spinner size="sm" label="Searching…" />
        </div>
      )}
      {accounts.length > 0 && (
        <ul className="card absolute z-10 mt-1 w-full divide-y divide-slate-100 py-1">
          {accounts.map((a) => (
            <li key={a.id} className="cursor-pointer px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => pickAccount(a)}>
              {a.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
