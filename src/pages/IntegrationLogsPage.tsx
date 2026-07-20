import { useEffect, useState } from 'react';
import { Cr9cd_integrationlogsService } from '../generated/services/Cr9cd_integrationlogsService';
import type { Cr9cd_integrationlogs } from '../generated/models/Cr9cd_integrationlogsModel';
import { integrationStatusChoice, integrationAdapterChoice } from '../dataverse/choiceMaps';
import { formatDateTime } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { Badge } from '../components/Badge';

export default function IntegrationLogsPage() {
  const [logs, setLogs] = useState<Cr9cd_integrationlogs[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Cr9cd_integrationlogsService
      .getAll({ orderBy: ['createdon desc'], top: 200 })
      .then((result) => setLogs(result.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  const columns: Column<Cr9cd_integrationlogs>[] = [
    { key: 'when', header: 'When', render: (l) => formatDateTime(l.createdon) },
    {
      key: 'adapter',
      header: 'Adapter',
      render: (l) => l.cr9cd_adaptername ?? (l.cr9cd_adapter != null ? integrationAdapterChoice.toValue(l.cr9cd_adapter) : '—'),
    },
    {
      key: 'operation',
      header: 'Operation',
      render: (l) => (
        <div>
          <span>{l.cr9cd_operation ?? '—'}</span>
          {l.cr9cd_error && <div className="text-xs text-rose-600">{l.cr9cd_error}</div>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (l) =>
        l.cr9cd_status != null ? (
          <Badge status={integrationStatusChoice.toValue(l.cr9cd_status)} />
        ) : l.cr9cd_statusname ? (
          <Badge>{l.cr9cd_statusname}</Badge>
        ) : (
          '—'
        ),
    },
    {
      key: 'duration',
      header: 'Duration',
      align: 'right',
      render: (l) => (l.cr9cd_duration_ms != null ? `${l.cr9cd_duration_ms} ms` : '—'),
    },
    { key: 'ref', header: 'Ref', render: (l) => l.cr9cd_request_ref || '—' },
  ];

  return (
    <div>
      <PageHeader title="Integration Logs" subtitle="Adapter calls and sync activity across integrations." />

      <DataTable
        columns={columns}
        rows={logs}
        keyFn={(l) => l.cr9cd_integrationlogid}
        loading={loading}
        emptyTitle="No integration logs"
      />
    </div>
  );
}
