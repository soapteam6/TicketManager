import type { CrmAccount, CrmResult, CrmOpportunity } from '@ais/shared';

export interface CrmAdapter {
  readonly provider: 'dynamics' | 'mock';
  // Step 1: find companies (accounts) by name.
  searchAccounts(query: string): Promise<CrmAccount[]>;
  // Step 2: list the contacts (people) belonging to a selected account.
  listContacts(accountId: string): Promise<CrmResult[]>;
  // Step 3: list opportunities on the selected account (revenue = Manual Rep Credit).
  listOpportunities(accountId: string): Promise<CrmOpportunity[]>;
}

export type { CrmAccount, CrmResult, CrmOpportunity };
