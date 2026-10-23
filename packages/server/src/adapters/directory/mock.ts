import type { DirectoryUser } from '@ais/shared';
import type { DirectoryAdapter } from './adapter.js';

// Sample active employees used until Graph credentials/consent are in place.
const USERS: DirectoryUser[] = [
  { id: 'demo-employee', displayName: 'Demo Employee', email: 'employee@example.invalid', jobTitle: 'Demo employee', department: 'Demo' },
  { id: 'demo-rep', displayName: 'Demo Representative', email: 'rep@example.invalid', jobTitle: 'Demo representative', department: 'Demo' },
  { id: 'demo-inactive', displayName: 'Inactive Directory Example', email: 'inactive@example.invalid', jobTitle: '', department: 'Demo', isActive: false },
  { id: 'u-9001', displayName: 'Jordan Lee', email: 'jordan.lee@example.invalid', jobTitle: 'Account Executive', department: 'Sales' },
  { id: 'u-9002', displayName: 'Sam Rivera', email: 'sam.rivera@example.invalid', jobTitle: 'Sales Manager', department: 'Sales' },
  { id: 'u-9003', displayName: 'Taylor Brooks', email: 'taylor.brooks@example.invalid', jobTitle: 'Solutions Engineer', department: 'Engineering' },
  { id: 'u-9004', displayName: 'Morgan Ellis', email: 'morgan.ellis@example.invalid', jobTitle: 'Marketing Lead', department: 'Marketing' },
  { id: 'u-9005', displayName: 'Casey Nguyen', email: 'casey.nguyen@example.invalid', jobTitle: 'Operations Analyst', department: 'Operations' },
  { id: 'u-9006', displayName: 'Riley Patel', email: 'riley.patel@example.invalid', jobTitle: 'Customer Success Manager', department: 'Customer Success' },
  { id: 'u-9007', displayName: 'Avery Collins', email: 'avery.collins@example.invalid', jobTitle: 'Field Technician', department: 'Field Services' },
  { id: 'u-9008', displayName: 'Jamie Torres', email: 'jamie.torres@example.invalid', jobTitle: 'VP Sales', department: 'Sales' },
];

export class MockDirectoryAdapter implements DirectoryAdapter {
  readonly provider = 'mock' as const;

  async searchUsers(query: string): Promise<DirectoryUser[]> {
    const q = query.trim().toLowerCase();
    if (!q) return USERS.map((u) => ({ ...u }));
    return USERS.filter(
      (u) => u.isActive !== false && (u.displayName.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q) || (u.department ?? '').toLowerCase().includes(q))
    ).slice(0, 15);
  }
}
