import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MOCK_PERSONAS, type AuthUser, type MockSession, type Role, type MockPersonaKey } from '@ais/shared';
import { api, apiErrorMessage } from '@/lib/api';

interface AuthContextValue {
  user: AuthUser;
  loading: boolean;
  hasRole: (...roles: Role[]) => boolean;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useQuery({ queryKey: ['mock-session'], queryFn: async () => (await api.get<MockSession>('/session')).data, retry: false });
  if (session.isLoading) return <p role="status" className="p-8">Loading local review session…</p>;
  if (!session.data) return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">Local review setup required</h1><p role="alert" className="my-4">{apiErrorMessage(session.error)}</p><p>Run <code>npm run dev:review</code> from the repository to start isolated synthetic fixtures. Production identity setup is still required before real use.</p></main>;
  const user = session.data.user;
  return <AuthContext.Provider value={{ user, loading: false, hasRole: (...roles) => roles.includes(user.role) }}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider required');
  return context;
}
export function RoleGate({ roles = ['admin'], children }: { roles?: Role[]; children: ReactNode }) {
  return useAuth().hasRole(...roles) ? <>{children}</> : null;
}
export function MockPersonaPicker() {
  const { user } = useAuth();
  const selected = Object.entries(MOCK_PERSONAS).find(([, p]) => p.email === user.email)?.[0] ?? 'coordinator';
  return <label className="text-xs text-slate-600">Synthetic persona
    <select aria-label="Synthetic persona" className="input ml-2 inline-block w-auto" value={selected} onChange={(e) => {
      const key = e.target.value as MockPersonaKey;
      try { sessionStorage.setItem('review-persona', key); } catch { /* URL fallback works without storage. */ }
      window.location.assign(`/?persona=${key}`);
    }}>{Object.entries(MOCK_PERSONAS).map(([key, p]) => <option key={key} value={key}>{p.fullName}</option>)}</select>
  </label>;
}
