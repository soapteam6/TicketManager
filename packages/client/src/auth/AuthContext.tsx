import { createContext, useContext, type ReactNode } from 'react';
import type { AuthUser, Role } from '@ais/shared';

// Authentication has been removed. This provider yields a static admin identity so components
// that read the current user or check roles keep working; every role check returns true.
interface AuthContextValue {
  user: AuthUser;
  loading: boolean;
  hasRole: (...roles: Role[]) => boolean;
}

const STATIC_USER: AuthUser = {
  id: 0,
  email: 'admin@ais.local',
  fullName: 'AIS Administrator',
  role: 'admin',
};

const value: AuthContextValue = {
  user: STATIC_USER,
  loading: false,
  hasRole: () => true,
};

const AuthContext = createContext<AuthContextValue>(value);

export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

// Auth removed → everyone is an admin, so gated content always renders. Kept for call-site
// compatibility (e.g. <RoleGate roles={['admin']}>...</RoleGate>).
export function RoleGate({ children }: { roles?: Role[]; children: ReactNode }) {
  return <>{children}</>;
}
