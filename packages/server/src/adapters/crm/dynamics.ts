import type { CrmAccount, CrmResult, CrmOpportunity } from '@ais/shared';
import { env } from '../../env.js';
import { logger } from '../../lib/logger.js';
import type { CrmAdapter } from './adapter.js';

// Live Microsoft Dynamics 365 / Dataverse client: OAuth 2.0 client-credentials + Web API (OData v9.2).
// Requires DYNAMICS_URL, DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET.
export class DynamicsCrmAdapter implements CrmAdapter {
  readonly provider = 'dynamics' as const;
  private token: { value: string; expiresAt: number } | null = null;

  private get baseUrl(): string {
    return (env.DYNAMICS_URL ?? '').replace(/\/$/, '');
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const url = `https://login.microsoftonline.com/${env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.DYNAMICS_CLIENT_ID!,
      client_secret: env.DYNAMICS_CLIENT_SECRET!,
      scope: `${this.baseUrl}/.default`,
    });
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw new Error(`Dynamics token request failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.token.value;
  }

  private async webApi<T>(path: string): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}/api/data/v9.2/${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Prefer: 'odata.include-annotations="*"',
      },
    });
    if (!res.ok) throw new Error(`Dynamics Web API ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async searchAccounts(query: string): Promise<CrmAccount[]> {
    const q = query.replace(/'/g, "''");
    const filter = `contains(name,'${q}')`;
    const path = `accounts?$select=accountid,name,emailaddress1,telephone1&$filter=${encodeURIComponent(filter)}&$orderby=name&$top=15`;
    const data = await this.webApi<{ value: DynamicsAccount[] }>(path);
    logger.debug({ query, count: data.value.length }, 'Dynamics account search');
    return data.value.map((a) => ({
      crmAccountId: a.accountid,
      name: a.name,
      email: a.emailaddress1 ?? null,
      phone: a.telephone1 ?? null,
      contactCount: null,
    }));
  }

  async listContacts(accountId: string): Promise<CrmResult[]> {
    const id = accountId.replace(/'/g, "''");
    // Contacts whose parent customer is this account.
    const filter = `_parentcustomerid_value eq ${id}`;
    const path =
      `contacts?$select=contactid,fullname,emailaddress1,telephone1,jobtitle,_parentcustomerid_value` +
      `&$filter=${encodeURIComponent(filter)}&$orderby=fullname&$top=100`;
    const data = await this.webApi<{ value: DynamicsContact[] }>(path);
    // The account name comes from an annotation on the lookup field.
    const accountName = data.value[0]?.['_parentcustomerid_value@OData.Community.Display.V1.FormattedValue'] ?? null;
    return data.value.map((c) => ({
      crmContactId: c.contactid,
      crmAccountId: accountId,
      fullName: c.fullname ?? 'Unknown',
      company: accountName,
      email: c.emailaddress1 ?? null,
      phone: c.telephone1 ?? null,
      title: c.jobtitle ?? null,
    }));
  }

  async listOpportunities(accountId: string): Promise<CrmOpportunity[]> {
    const id = accountId.replace(/'/g, "''");
    const revField = env.DYNAMICS_OPP_REVENUE_FIELD;
    const filter = `_parentaccountid_value eq ${id}`;
    const path =
      `opportunities?$select=opportunityid,name,estimatedvalue,statecode,${revField}` +
      `&$filter=${encodeURIComponent(filter)}&$orderby=createdon desc&$top=50`;
    const data = await this.webApi<{ value: Array<Record<string, unknown>> }>(path);
    return data.value.map((o) => ({
      crmOpportunityId: String(o.opportunityid),
      name: (o.name as string) ?? 'Opportunity',
      revenue: typeof o[revField] === 'number' ? (o[revField] as number) : null,
      estimatedValue: typeof o.estimatedvalue === 'number' ? (o.estimatedvalue as number) : null,
      status: (o['statecode@OData.Community.Display.V1.FormattedValue'] as string) ?? null,
    }));
  }
}

interface DynamicsAccount {
  accountid: string;
  name: string;
  emailaddress1?: string;
  telephone1?: string;
}

interface DynamicsContact {
  contactid: string;
  fullname?: string;
  emailaddress1?: string;
  telephone1?: string;
  jobtitle?: string;
  _parentcustomerid_value?: string | null;
  '_parentcustomerid_value@OData.Community.Display.V1.FormattedValue'?: string;
}
