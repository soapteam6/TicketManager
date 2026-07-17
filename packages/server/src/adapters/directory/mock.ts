import type { DirectoryUser } from '@ais/shared';
import type { DirectoryAdapter } from './adapter.js';

// Sample active employees used until Graph credentials/consent are in place.
const USERS: DirectoryUser[] = [
  { id: 'u-9001', displayName: 'Jordan Lee', email: 'jordan.lee@ais-now.com', jobTitle: 'Account Executive', department: 'Sales' },
  { id: 'u-9002', displayName: 'Sam Rivera', email: 'sam.rivera@ais-now.com', jobTitle: 'Sales Manager', department: 'Sales' },
  { id: 'u-9003', displayName: 'Taylor Brooks', email: 'taylor.brooks@ais-now.com', jobTitle: 'Solutions Engineer', department: 'Engineering' },
  { id: 'u-9004', displayName: 'Morgan Ellis', email: 'morgan.ellis@ais-now.com', jobTitle: 'Marketing Lead', department: 'Marketing' },
  { id: 'u-9005', displayName: 'Casey Nguyen', email: 'casey.nguyen@ais-now.com', jobTitle: 'Operations Analyst', department: 'Operations' },
  { id: 'u-9006', displayName: 'Riley Patel', email: 'riley.patel@ais-now.com', jobTitle: 'Customer Success Manager', department: 'Customer Success' },
  { id: 'u-9007', displayName: 'Avery Collins', email: 'avery.collins@ais-now.com', jobTitle: 'Field Technician', department: 'Field Services' },
  { id: 'u-9008', displayName: 'Jamie Torres', email: 'jamie.torres@ais-now.com', jobTitle: 'VP Sales', department: 'Sales' },
];

export class MockDirectoryAdapter implements DirectoryAdapter {
  readonly provider = 'mock' as const;

  async searchUsers(query: string): Promise<DirectoryUser[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return USERS.filter(
      (u) => u.displayName.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q) || (u.department ?? '').toLowerCase().includes(q)
    ).slice(0, 15);
  }
}
