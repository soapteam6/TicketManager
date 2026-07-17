import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Spinner } from './Spinner';
import { EmptyState } from './EmptyState';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

export function DataTable<T>({
  columns,
  rows,
  keyFn,
  loading,
  onRowClick,
  emptyTitle = 'No records',
  emptyDescription,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  keyFn: (row: T, index: number) => string | number;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
}) {
  if (loading) {
    return (
      <div className="card flex items-center justify-center p-12">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  const alignClass = (align?: Column<T>['align']) =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={clsx(
                    'whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500',
                    alignClass(col.align),
                    col.className
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row, i) => (
              <tr
                key={keyFn(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={clsx('transition', onRowClick && 'cursor-pointer hover:bg-slate-50')}
              >
                {columns.map((col) => (
                  <td key={col.key} className={clsx('whitespace-nowrap px-4 py-3 text-slate-700', alignClass(col.align), col.className)}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
