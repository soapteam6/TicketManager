// An active user from the Entra (Azure AD) directory — used to pick employee beneficiaries.
export interface DirectoryUser {
  id: string; // Entra object id
  displayName: string;
  email: string | null;
  jobTitle: string | null;
  department: string | null;
}

export interface DirectoryStatus {
  configured: boolean; // true when Graph credentials are present (live), false = sample data
  provider: 'graph' | 'mock';
}
