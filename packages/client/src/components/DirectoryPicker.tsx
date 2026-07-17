import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DirectoryUser, DirectoryStatus } from '@ais/shared';
import { api, apiErrorMessage } from '@/lib/api';
import { Badge } from './Badge';
import { Spinner } from './Spinner';

const userKey = (u: DirectoryUser) => u.id ?? u.email ?? u.displayName;

// Search ACTIVE Entra directory users and multi-select them as employee beneficiaries.
export function DirectoryPicker({ onChange }: { onChange: (users: DirectoryUser[]) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<DirectoryUser[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    onChange(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const status = useQuery({
    queryKey: ['directory', 'status'],
    queryFn: async () => (await api.get<DirectoryStatus>('/directory/status')).data,
    staleTime: 300_000,
  });
  const search = useQuery({
    queryKey: ['directory', 'search', debounced],
    queryFn: async () => (await api.get<{ users: DirectoryUser[] }>('/directory/search', { params: { q: debounced } })).data.users,
    enabled: debounced.length >= 2,
    retry: false,
  });

  function toggle(u: DirectoryUser) {
    setSelected((prev) => (prev.some((x) => userKey(x) === userKey(u)) ? prev.filter((x) => userKey(x) !== userKey(u)) : [...prev, u]));
  }

  const results = search.data ?? [];

  return (
    <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">Entra Directory</div>
        {status.data && <Badge tone={status.data.configured ? 'green' : 'amber'}>{status.data.configured ? 'Live Directory' : 'Sample data'}</Badge>}
      </div>

      <div className="relative">
        <label className="mb-1 block text-xs font-medium text-slate-600">Search active employees — {selected.length} selected</label>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a name or email…"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        />
        {search.isFetching && <div className="absolute right-2.5 top-7"><Spinner size="sm" /></div>}
      </div>

      {search.isError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Directory unavailable: {apiErrorMessage(search.error)}. If live, grant the app registration
          Microsoft Graph <span className="font-mono">User.Read.All</span> (admin consent), or set
          <span className="font-mono"> DIRECTORY_PROVIDER=mock</span> to use sample employees.
        </div>
      )}

      {debounced.length >= 2 && !search.isError && (
        <div className="max-h-52 overflow-auto rounded-md border border-slate-200 bg-white">
          {results.length === 0 && !search.isFetching && <div className="px-3 py-2 text-sm text-slate-400">No matching users.</div>}
          {results.map((u) => {
            const checked = selected.some((x) => userKey(x) === userKey(u));
            return (
              <label key={userKey(u)} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-0 hover:bg-brand-50">
                <input type="checkbox" checked={checked} onChange={() => toggle(u)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-slate-900">{u.displayName}</span>
                  <span className="block text-xs text-slate-500">{[u.jobTitle, u.department, u.email].filter(Boolean).join(' · ')}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
