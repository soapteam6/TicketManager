import type { DirectoryUser } from '@ais/shared';
import { env } from '../../env.js';
import { logger } from '../../lib/logger.js';
import type { DirectoryAdapter } from './adapter.js';

// Live Microsoft Entra (Azure AD) directory via Microsoft Graph. Reuses the Dynamics app
// registration's credentials, but needs the Graph application permission User.Read.All (+ admin
// consent) on that app. Client-credentials token, scoped to Graph.
export class GraphDirectoryAdapter implements DirectoryAdapter {
  readonly provider = 'graph' as const;
  private token: { value: string; expiresAt: number } | null = null;

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const url = `https://login.microsoftonline.com/${env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.DYNAMICS_CLIENT_ID!,
      client_secret: env.DYNAMICS_CLIENT_SECRET!,
      scope: 'https://graph.microsoft.com/.default',
    });
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw new Error(`Graph token request failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.token.value;
  }

  async searchUsers(query: string): Promise<DirectoryUser[]> {
    const q = query.replace(/'/g, "''");
    const token = await this.getToken();
    const filter = `accountEnabled eq true and (startswith(displayName,'${q}') or startswith(mail,'${q}') or startswith(userPrincipalName,'${q}'))`;
    const url =
      `https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName,jobTitle,department` +
      `&$filter=${encodeURIComponent(filter)}&$top=15&$count=true&$orderby=displayName`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ConsistencyLevel: 'eventual' },
    });
    if (!res.ok) throw new Error(`Graph /users ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { value: GraphUser[] };
    logger.debug({ query, count: data.value.length }, 'Graph directory search');
    return data.value.map((u) => ({
      id: u.id,
      displayName: u.displayName ?? u.userPrincipalName ?? 'Unknown',
      email: u.mail ?? u.userPrincipalName ?? null,
      jobTitle: u.jobTitle ?? null,
      department: u.department ?? null,
    }));
  }
}

interface GraphUser {
  id: string;
  displayName?: string;
  mail?: string | null;
  userPrincipalName?: string;
  jobTitle?: string | null;
  department?: string | null;
}
