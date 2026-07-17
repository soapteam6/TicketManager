// A company (account) surfaced from Dynamics 365 CRM — step 1 of the intake picker.
export interface CrmAccount {
  crmAccountId: string;
  name: string;
  email: string | null;
  phone: string | null;
  contactCount: number | null;
}

// A contact within a selected account — step 2 of the intake picker.
export interface CrmResult {
  crmContactId: string | null; // Dynamics contactid (person)
  crmAccountId: string | null; // Dynamics accountid (company)
  fullName: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
}

// An opportunity on the selected account — step 3 of the intake picker.
// `revenue` is the "Manual Rep Credit" field, used as the request's revenue value.
export interface CrmOpportunity {
  crmOpportunityId: string;
  name: string;
  revenue: number | null; // Manual Rep Credit (ais_manualrepcredit)
  estimatedValue: number | null;
  status: string | null;
}

export interface CrmStatus {
  configured: boolean; // true when DYNAMICS_* env vars are present (live), false = sample data
  provider: 'dynamics' | 'mock';
}
