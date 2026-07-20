import { useEffect, useState } from 'react';
import { searchAccounts, listContactsForAccount, listOpportunitiesForAccount } from '../services/crmService';
import type { CrmAccountSummary, CrmContactSummary, CrmOpportunitySummary } from '../services/crmService';
import { TextInput } from './Field';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { formatUsd } from '../lib/format';

export interface CrmSelection {
  account: CrmAccountSummary;
  contact: CrmContactSummary;
  opportunity: CrmOpportunitySummary | null;
}

// Account -> pick a contact (required) and optionally an opportunity (for its Manual Rep Credit) ->
// confirm. Both contacts and opportunities are cross-org reads against the real DynamicsCRM org
// (see crmService.ts) -- this picker never writes anywhere itself.
export default function CrmPicker({ onSelect }: { onSelect: (selection: CrmSelection) => void }) {
  const [query, setQuery] = useState('');
  const [accounts, setAccounts] = useState<CrmAccountSummary[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<CrmAccountSummary | null>(null);
  const [contacts, setContacts] = useState<CrmContactSummary[]>([]);
  const [opportunities, setOpportunities] = useState<CrmOpportunitySummary[]>([]);
  const [selectedContact, setSelectedContact] = useState<CrmContactSummary | null>(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState<CrmOpportunitySummary | null>(null);
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
    setSelectedContact(null);
    setSelectedOpportunity(null);
    setLoading(true);
    try {
      const [contactResult, opportunityResult] = await Promise.all([listContactsForAccount(account.id), listOpportunitiesForAccount(account.id)]);
      setContacts(contactResult);
      setOpportunities(opportunityResult);
    } finally {
      setLoading(false);
    }
  }

  if (selectedAccount) {
    return (
      <div className="card mb-3 p-4">
        <div className="mb-3 flex items-center gap-3">
          <div>
            <strong className="text-sm text-slate-900">{selectedAccount.name}</strong>
            {selectedAccount.ownerName && <div className="text-xs text-slate-500">Owner: {selectedAccount.ownerName}</div>}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedAccount(null);
              setContacts([]);
              setOpportunities([]);
              setSelectedContact(null);
              setSelectedOpportunity(null);
              setQuery('');
            }}
          >
            Change account
          </Button>
        </div>
        {loading && <Spinner size="sm" label="Loading contacts & opportunities…" />}

        {!loading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Contact <span className="text-rose-500">*</span>
              </h4>
              {contacts.length === 0 && <p className="text-sm text-slate-400">No contacts found for this account.</p>}
              <ul className="divide-y divide-slate-100">
                {contacts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-slate-700">
                      {c.fullName} {c.title ? <span className="text-slate-400">— {c.title}</span> : ''}
                    </span>
                    <Button size="sm" variant={selectedContact?.id === c.id ? 'success' : 'secondary'} onClick={() => setSelectedContact(c)}>
                      {selectedContact?.id === c.id ? 'Selected' : 'Use'}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Opportunity (optional)</h4>
              {opportunities.length === 0 && <p className="text-sm text-slate-400">No open opportunities for this account.</p>}
              <ul className="divide-y divide-slate-100">
                {opportunities.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-slate-700">
                      {o.name}
                      {o.manualRepCredit != null ? (
                        <span className="text-slate-400"> — {formatUsd(o.manualRepCredit)} rep credit</span>
                      ) : o.estimatedValue != null ? (
                        <span className="text-slate-400"> — {formatUsd(o.estimatedValue)} est.</span>
                      ) : null}
                    </span>
                    <Button
                      size="sm"
                      variant={selectedOpportunity?.id === o.id ? 'success' : 'secondary'}
                      onClick={() => setSelectedOpportunity(selectedOpportunity?.id === o.id ? null : o)}
                    >
                      {selectedOpportunity?.id === o.id ? 'Selected' : 'Use'}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
          <Button
            disabled={!selectedContact}
            onClick={() => selectedContact && onSelect({ account: selectedAccount, contact: selectedContact, opportunity: selectedOpportunity })}
          >
            Confirm selection
          </Button>
        </div>
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
