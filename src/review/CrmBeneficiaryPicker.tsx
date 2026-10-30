import { useEffect, useState } from 'react';
import { useReview } from './context';
import { Button, Field, TextInput } from './ui';
import { CopyErrorButton } from './CopyErrorButton';
import { createErrorReport, type ErrorReport } from './errorReport';
import type { CrmAccount, CrmBeneficiary, CrmPerson } from './types';

export function CrmBeneficiaryPicker({ selected, onChange }: {
  selected: CrmBeneficiary[]; onChange: (people: CrmBeneficiary[]) => void;
}) {
  const { provider } = useReview();
  const directory = provider.crm;
  const [account, setAccount] = useState<CrmAccount | null>(() => selected[0] ? { id: selected[0].accountId, name: selected[0].accountName, ownerName: null } : null);
  const [query, setQuery] = useState('');
  const [contactQuery, setContactQuery] = useState('');
  const [accounts, setAccounts] = useState<CrmAccount[]>([]);
  const [contacts, setContacts] = useState<CrmPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorReport | null>(null);
  useEffect(() => {
    let current = true;
    if (!directory) return;
    const timer = setTimeout(() => {
      if (!account && query.trim().length < 2) { setAccounts([]); setLoading(false); setError(null); return; }
      setLoading(true); setError(null); setAccounts([]); setContacts([]);
      const search = account ? directory.searchContacts(account.id, contactQuery) : directory.searchAccounts(query);
      search.then(rows => {
        if (!current) return;
        if (account) setContacts((rows as CrmPerson[]).slice(0, 25));
        else setAccounts((rows as CrmAccount[]).slice(0, 10));
      }).catch(err => { if (current) setError(createErrorReport(err, 'Search CRM contacts')); })
        .finally(() => { if (current) setLoading(false); });
    }, 300);
    return () => { current = false; clearTimeout(timer); };
  }, [directory, account, query, contactQuery]);
  function changeAccount(next: CrmAccount | null) {
    setAccount(next); setContactQuery(''); setAccounts([]); setContacts([]); setError(null); onChange([]);
  }
  if (!directory) return <p className="text-sm">CRM search is unavailable. Choose a saved contact.</p>;
  return <section className="space-y-3" aria-label="CRM customer contacts">
    {account ? <div className="flex items-center justify-between gap-3 rounded border border-slate-200 p-3 text-sm">
      <strong>{account.name}</strong><Button type="button" variant="secondary" size="sm" onClick={() => changeAccount(null)}>Change business</Button>
    </div> : <Field label="Find CRM business"><TextInput value={query} maxLength={100} placeholder="Search parent businesses (at least 2 characters)" onChange={e => { setQuery(e.target.value); setAccounts([]); }} /></Field>}
    {account && <Field label="Find CRM contacts"><TextInput value={contactQuery} maxLength={100} placeholder="Filter by name or email" onChange={e => { setContactQuery(e.target.value); setContacts([]); }} /></Field>}
    {loading && <p role="status" className="text-sm text-slate-500">Searching CRM…</p>}
    {error && <div role="alert" className="space-y-2 text-sm text-red-700"><p>{error.message}</p><CopyErrorButton details={error.details} /><Button type="button" variant="secondary" size="sm" onClick={() => { setQuery(q => q + ' '); }}>Retry search</Button></div>}
    {!account && <div className="max-h-48 overflow-y-auto" aria-label="CRM business results">{accounts.map(a => <button key={a.id} type="button" className="block w-full border-b border-slate-100 p-3 text-left text-sm hover:bg-slate-50" onClick={() => changeAccount(a)}><strong>{a.name}</strong>{a.ownerName && <span className="block text-xs text-slate-500">{a.ownerName}</span>}</button>)}</div>}
    {account && <div className="max-h-48 overflow-y-auto" aria-label="CRM contact results">{contacts.map(c => <label key={c.id} className="flex cursor-pointer gap-3 border-b border-slate-100 p-3 text-sm hover:bg-slate-50"><input type="checkbox" className="mt-1" checked={selected.some(p => p.contactId === c.id)} onChange={e => onChange(e.target.checked ? [...selected, { contactId: c.id, accountId: account.id, accountName: account.name, name: c.fullName, email: c.email ?? '', phone: c.phone ?? '' }] : selected.filter(p => p.contactId !== c.id))} /><span>{c.fullName}<span className="block text-xs text-slate-600">{c.email || 'No email recorded'}</span></span></label>)}</div>}
    {!loading && !error && (account || query.trim().length >= 2) && !(account ? contacts : accounts).length && <p className="text-sm text-slate-500">No matching {account ? 'contacts' : 'businesses'}.</p>}
    {(account ? contacts.length >= 25 : accounts.length >= 10) && <p className="text-xs text-slate-500">Showing the first {account ? 25 : 10} results. Refine your search to find someone else.</p>}
    {selected.length > 0 && <div className="max-h-32 overflow-y-auto rounded border border-slate-200 p-3 text-sm" aria-label="Selected CRM contacts"><strong>{selected.length} selected</strong>{selected.map(c => <div key={c.contactId} className="mt-2 flex items-start justify-between gap-3"><span>{c.name}<span className="block text-xs text-slate-500">{c.email}</span></span><button type="button" className="text-xs underline" aria-label={`Remove ${c.name}`} onClick={() => onChange(selected.filter(p => p.contactId !== c.contactId))}>Remove</button></div>)}</div>}
  </section>;
}
