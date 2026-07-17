import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { INTEGRATION_ADAPTER, INTEGRATION_STATUS } from '@ais/shared';
import { api } from '@/lib/api';
import type { IntegrationLog } from '@/lib/types';
import { pickArray } from '@/lib/unwrap';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { Field, Select, EnumOptions } from '@/components/Field';

export function IntegrationLogsPage() {
  const [adapter, setAdapter] = useState('');
  const [status, setStatus] = useState('');

  const logs = useQuery({
    queryKey: ['integrations', 'logs', { adapter, status }],
    queryFn: async () => {
      const res = await api.get('/integrations/logs', {
        params: { ...(adapter ? { adapter } : {}), ...(status ? { status } : {}) },
      });
      return pickArray<IntegrationLog>(res.data, 'logs');
    },
  });

  const columns: Column<IntegrationLog>[] = [
    { key: 'time', header: 'Time', render: (l) => formatDateTime(l.createdAt) },
    { key: 'adapter', header: 'Adapter', render: (l) => <Badge tone="slate">{l.adapter}</Badge> },
    { key: 'op', header: 'Operation', render: (l) => l.operation },
    { key: 'status', header: 'Status', render: (l) => <Badge status={l.status} /> },
    { key: 'dur', header: 'Duration', align: 'right', render: (l) => (l.durationMs != null ? `${l.durationMs} ms` : '—') },
    { key: 'err', header: 'Error', render: (l) => (l.error ? <span className="text-rose-600">{l.error}</span> : <span className="text-slate-400">—</span>) },
  ];

  return (
    <div>
      <PageHeader
        title="Integration Logs"
        subtitle="Adapter activity across ticketing, email intake, narrative, and schedule import."
        actions={
          <>
            <Field className="w-44">
              <Select value={adapter} onChange={(e) => setAdapter(e.target.value)}>
                <EnumOptions values={INTEGRATION_ADAPTER} includeBlank blankLabel="All adapters" />
              </Select>
            </Field>
            <Field className="w-40">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <EnumOptions values={INTEGRATION_STATUS} includeBlank blankLabel="All statuses" />
              </Select>
            </Field>
          </>
        }
      />

      <QueryState isLoading={logs.isLoading} error={logs.error}>
        <DataTable columns={columns} rows={logs.data} keyFn={(l) => l.id} emptyTitle="No log entries" />
      </QueryState>
    </div>
  );
}
