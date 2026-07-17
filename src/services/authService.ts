import { getContext } from '@microsoft/power-apps/app';

export interface CurrentUser {
  fullName: string;
  userPrincipalName: string;
  objectId: string;
  isAdmin: boolean;
}

let cached: Promise<CurrentUser> | null = null;

// Memoized for the life of the session -- avoids re-querying context on every page navigation.
export function getCurrentUser(): Promise<CurrentUser> {
  if (!cached) cached = resolveCurrentUser();
  return cached;
}

// Everyone using the app is treated as admin for now.
async function resolveCurrentUser(): Promise<CurrentUser> {
  const ctx = await getContext();
  const objectId = ctx.user.objectId ?? '';
  const fullName = ctx.user.fullName ?? '';
  const userPrincipalName = ctx.user.userPrincipalName ?? '';

  return { fullName, userPrincipalName, objectId, isAdmin: true };
}
