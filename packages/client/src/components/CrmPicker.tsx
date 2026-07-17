import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CrmAccount, CrmResult, CrmOpportunity, CrmStatus } from '@ais/shared';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/format';
import { Badge } from './Badge';
import { Spinner } from './Spinner';

export interface CrmSelection {
  account: CrmAccount;
  contacts: CrmResult[];
  opportunity: CrmOpportunity | null;
}

const contactKey = (c: CrmResult) => c.crmContactId ?? c.email ?? c.fullName;

// Three-step Dynamics 365 picker: company -> one or more contacts -> opportunity (revenue).
export function CrmPicker({ onChange }: { onChange: (sel: CrmSelection | null) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [account, setAccount] = useState<CrmAccount | null>(null);
  const [selected, setSelected] = useState<CrmResult[]>([]);
  const [opportunity, setOpportunity] = useState<CrmOpportunity | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Emit the selection upward whenever it changes.
  useEffect(() => {
    onChange(account ? { account, contacts: selected, opportunity } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, selected, opportunity]);

  const status = useQuery({
    queryKey: ['crm', 'status'],
    queryFn: async () => (await api.get<CrmStatus>('/crm/status')).data,
    staleTime: 300_000,
  });
  const accounts = useQuery({
    queryKey: ['crm', 'accounts', debounced],
    queryFn: async () => (await api.get<{ accounts: CrmAccount[] }>('/crm/accounts', { params: { q: debounced } })).data.accounts,
    enabled: debounced.length >= 2 && !account,
  });
  const contacts = useQuery({
    queryKey: ['crm', 'contacts', account?.crmAccountId],
    queryFn: async () => (await api.get<{ contacts: CrmResult[] }>(`/crm/accounts/${encodeURIComponent(account!.crmAccountId)}/contacts`)).data.contacts,
    enabled: !!account,
  });
  const opportunities = useQuery({
    queryKey: ['crm', 'opps', account?.crmAccountId],
    queryFn: async () => (await api.get<{ opportunities: CrmOpportunity[] }>(`/crm/accounts/${encodeURIComponent(account!.crmAccountId)}/opportunities`)).data.opportunities,
    enabled: !!account,
  });

  function pickAccount(a: CrmAccount) {
    setAccount(a);
    setSelected([]);
    setOpportunity(null);
  }
  function reset() {
    setAccount(null);
    setSelected([]);
    setOpportunity(null);
    setQ('');
  }
  function toggleContact(c: CrmResult) {
    setSelected((prev) => (prev.some((x) => contactKey(x) === contactKey(c)) ? prev.filter((x) => contactKey(x) !== contactKey(c)) : [...prev, c]));
  }

  return (
    <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">Dynamics 365 CRM</div>
        {status.data && <Badge tone={status.data.configured ? 'green' : 'amber'}>{status.data.configured ? 'Live Dynamics' : 'Sample data'}</Badge>}
      </div>

      {/* Step 1 — company */}
      {!account ? (
        <div className="relative">
          <label className="mb-1 block text-xs font-medium text-slate-600">1. Search company (account)</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a company name…"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
          {accounts.isFetching && <div className="absolute right-2.5 top-7"><Spinner size="sm" /></div>}
          {debounced.length >= 2 && (
            <div className="mt-1 max-h-48 overflow-auto rounded-md border border-slate-200 bg-white shadow-sm">
              {accounts.isError && <div className="px-3 py-2 text-sm text-red-600">CRM unavailable.</div>}
              {!accounts.isError && (accounts.data?.length ?? 0) === 0 && !accounts.isFetching && <div className="px-3 py-2 text-sm text-slate-400">No companies match.</div>}
              {accounts.data?.map((a) => (
                <button key={a.crmAccountId} type="button" onClick={() => pickAccount(a)} className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-brand-50">
                  <span className="text-sm font-medium text-slate-900">{a.name}</span>
                  {a.contactCount != null && <span className="text-xs text-slate-400">{a.contactCount} contacts</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-md bg-white px-3 py-2">
          <div>
            <div className="text-[11px] font-medium uppercase text-slate-400">Company</div>
            <div className="text-sm font-semibold text-slate-900">{account.name}</div>
          </div>
          <button type="button" onClick={reset} className="text-xs font-medium text-brand-700 hover:underline">Change</button>
        </div>
      )}

      {/* Step 2 — contacts (multi-select) */}
      {account && (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">2. Select contact(s) — {selected.length} chosen</label>
          {contacts.isFetching ? (
            <div className="py-2"><Spinner size="sm" label="Loading contacts…" /></div>
          ) : contacts.isError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">Could not load contacts.</div>
          ) : (
            <div className="max-h-44 overflow-auto rounded-md border border-slate-200 bg-white">
              {(contacts.data?.length ?? 0) === 0 && <div className="px-3 py-2 text-sm text-slate-400">No contacts on this account.</div>}
              {contacts.data?.map((c) => {
                const checked = selected.some((x) => contactKey(x) === contactKey(c));
                return (
                  <label key={contactKey(c)} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-0 hover:bg-brand-50">
                    <input type="checkbox" checked={checked} onChange={() => toggleContact(c)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-slate-900">{c.fullName}</span>
                      <span className="block text-xs text-slate-500">{[c.title, c.email].filter(Boolean).join(' · ')}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 3 — opportunity (revenue = Manual Rep Credit) */}
      {account && (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">3. Select opportunity (revenue = Manual Rep Credit)</label>
          {opportunities.isFetching ? (
            <div className="py-2"><Spinner size="sm" label="Loading opportunities…" /></div>
          ) : opportunities.isError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">Could not load opportunities.</div>
          ) : (
            <div className="max-h-44 overflow-auto rounded-md border border-slate-200 bg-white">
              {(opportunities.data?.length ?? 0) === 0 && <div className="px-3 py-2 text-sm text-slate-400">No opportunities on this account.</div>}
              {opportunities.data?.map((o) => {
                const active = opportunity?.crmOpportunityId === o.crmOpportunityId;
                return (
                  <button
                    key={o.crmOpportunityId}
                    type="button"
                    onClick={() => setOpportunity(active ? null : o)}
                    className={`flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-brand-50 ${active ? 'bg-brand-50' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">{o.name}</span>
                      {o.status && <span className="block text-xs text-slate-400">{o.status}</span>}
                    </span>
                    <span className="ml-3 shrink-0 text-right">
                      <span className="block text-sm font-semibold text-brand-700">{o.revenue != null ? formatUsd(o.revenue) : '—'}</span>
                      <span className="block text-[10px] text-slate-400">Manual Rep Credit</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
