import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from './Spinner';
import { EmptyState } from './EmptyState';

// UI-level gate only -- it hides the page from non-admins but does not restrict the underlying
// Dataverse tables, which everyone in the environment can still query/write directly.
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="card flex items-center justify-center p-12">
        <Spinner label="Checking access…" />
      </div>
    );
  }

  if (!user?.isAdmin) {
    return (
      <EmptyState
        title="Admins only"
        description="The scoring engine is restricted to Dataverse System Administrators / Customizers. Ask an admin if you need changes made here."
      />
    );
  }

  return <>{children}</>;
}
