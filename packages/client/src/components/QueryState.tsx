import type { ReactNode } from 'react';
import { Spinner } from './Spinner';
import { apiErrorMessage } from '@/lib/api';

// Standard loading/error scaffold for a react-query result.
export function QueryState({
  isLoading,
  error,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  children: ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="card flex items-center justify-center p-12">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {apiErrorMessage(error, 'Failed to load data.')}
      </div>
    );
  }
  return <>{children}</>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {apiErrorMessage(error)}
    </div>
  );
}
