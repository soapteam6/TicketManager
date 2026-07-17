import type { DirectoryUser } from '@ais/shared';

export interface DirectoryAdapter {
  readonly provider: 'graph' | 'mock';
  // Search ACTIVE users in the Entra directory by name / email.
  searchUsers(query: string): Promise<DirectoryUser[]>;
}

export type { DirectoryUser };
