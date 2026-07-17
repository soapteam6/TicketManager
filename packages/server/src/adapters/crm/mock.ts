import type { CrmAccount, CrmResult, CrmOpportunity } from '@ais/shared';
import type { CrmAdapter } from './adapter.js';

interface MockAccount {
  crmAccountId: string;
  name: string;
  email: string | null;
  phone: string | null;
  contacts: Array<{ crmContactId: string; fullName: string; email: string; phone: string; title: string }>;
}

// Sample "Dataverse" data used until DYNAMICS_* env vars are configured. Accounts have multiple
// contacts so the account -> contacts picker behaves exactly like the live one.
const ACCOUNTS: MockAccount[] = [
  {
    crmAccountId: 'a-2001',
    name: 'Summit Realty Group',
    email: 'info@summitrealty.com',
    phone: '702-555-0100',
    contacts: [
      { crmContactId: 'c-1001', fullName: 'Alice Nguyen', email: 'alice.nguyen@summitrealty.com', phone: '702-555-0110', title: 'VP Operations' },
      { crmContactId: 'c-1013', fullName: 'Brian Ford', email: 'brian.ford@summitrealty.com', phone: '702-555-0111', title: 'Broker' },
      { crmContactId: 'c-1014', fullName: 'Dana Reyes', email: 'dana.reyes@summitrealty.com', phone: '702-555-0112', title: 'Office Manager' },
    ],
  },
  {
    crmAccountId: 'a-2002',
    name: 'Bell Logistics',
    email: 'contact@belllogistics.com',
    phone: '702-555-0120',
    contacts: [
      { crmContactId: 'c-1002', fullName: 'Marcus Bell', email: 'marcus.bell@belllogistics.com', phone: '702-555-0121', title: 'Owner' },
      { crmContactId: 'c-1015', fullName: 'Sofia Bell', email: 'sofia.bell@belllogistics.com', phone: '702-555-0122', title: 'Operations Lead' },
    ],
  },
  {
    crmAccountId: 'a-2003',
    name: 'Desert Financial Partners',
    email: 'hello@desertfin.com',
    phone: '702-555-0130',
    contacts: [
      { crmContactId: 'c-1003', fullName: 'Priya Shah', email: 'priya.shah@desertfin.com', phone: '702-555-0131', title: 'Managing Director' },
      { crmContactId: 'c-1016', fullName: 'Evan Wright', email: 'evan.wright@desertfin.com', phone: '702-555-0132', title: 'Advisor' },
    ],
  },
  {
    crmAccountId: 'a-2004',
    name: 'Alvarez Construction',
    email: 'office@alvarezbuild.com',
    phone: '702-555-0140',
    contacts: [
      { crmContactId: 'c-1004', fullName: 'Tom Alvarez', email: 'tom@alvarezbuild.com', phone: '702-555-0141', title: 'President' },
    ],
  },
  {
    crmAccountId: 'a-2008',
    name: 'Haddad Auto Group',
    email: 'sales@haddadauto.com',
    phone: '702-555-0180',
    contacts: [
      { crmContactId: 'c-1008', fullName: 'Omar Haddad', email: 'omar@haddadauto.com', phone: '702-555-0181', title: 'Dealer Principal' },
      { crmContactId: 'c-1017', fullName: 'Lena Haddad', email: 'lena.haddad@haddadauto.com', phone: '702-555-0182', title: 'Finance Director' },
    ],
  },
  {
    crmAccountId: 'a-2009',
    name: 'Skyline Hotels',
    email: 'gm@skylinehotels.com',
    phone: '702-555-0190',
    contacts: [
      { crmContactId: 'c-1009', fullName: 'Jenny Park', email: 'jenny.park@skylinehotels.com', phone: '702-555-0191', title: 'Regional GM' },
      { crmContactId: 'c-1018', fullName: 'Raj Patel', email: 'raj.patel@skylinehotels.com', phone: '702-555-0192', title: 'Events Manager' },
    ],
  },
];

// Sample opportunities per account. `revenue` stands in for the Manual Rep Credit field.
const OPPORTUNITIES: Record<string, CrmOpportunity[]> = {
  'a-2001': [
    { crmOpportunityId: 'o-3001', name: 'Managed Network Refresh', revenue: 45000, estimatedValue: 120000, status: 'Open' },
    { crmOpportunityId: 'o-3002', name: 'VoIP Rollout', revenue: 18000, estimatedValue: 60000, status: 'Open' },
  ],
  'a-2002': [{ crmOpportunityId: 'o-3003', name: 'Fleet Telematics', revenue: 32000, estimatedValue: 90000, status: 'Open' }],
  'a-2003': [
    { crmOpportunityId: 'o-3004', name: 'Cloud Migration', revenue: 61000, estimatedValue: 150000, status: 'Open' },
    { crmOpportunityId: 'o-3005', name: 'Security Assessment', revenue: 9000, estimatedValue: 25000, status: 'Won' },
  ],
  'a-2004': [{ crmOpportunityId: 'o-3006', name: 'Jobsite Connectivity', revenue: 14000, estimatedValue: 40000, status: 'Open' }],
  'a-2008': [{ crmOpportunityId: 'o-3007', name: 'Dealership Wi-Fi Upgrade', revenue: 22000, estimatedValue: 70000, status: 'Open' }],
  'a-2009': [{ crmOpportunityId: 'o-3008', name: 'Property MRR Bundle', revenue: 38000, estimatedValue: 110000, status: 'Open' }],
};

export class MockCrmAdapter implements CrmAdapter {
  readonly provider = 'mock' as const;

  async listOpportunities(accountId: string): Promise<CrmOpportunity[]> {
    return OPPORTUNITIES[accountId] ?? [];
  }

  async searchAccounts(query: string): Promise<CrmAccount[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return ACCOUNTS.filter((a) => a.name.toLowerCase().includes(q))
      .slice(0, 15)
      .map((a) => ({ crmAccountId: a.crmAccountId, name: a.name, email: a.email, phone: a.phone, contactCount: a.contacts.length }));
  }

  async listContacts(accountId: string): Promise<CrmResult[]> {
    const account = ACCOUNTS.find((a) => a.crmAccountId === accountId);
    if (!account) return [];
    return account.contacts.map((c) => ({
      crmContactId: c.crmContactId,
      crmAccountId: account.crmAccountId,
      fullName: c.fullName,
      company: account.name,
      email: c.email,
      phone: c.phone,
      title: c.title,
    }));
  }
}
