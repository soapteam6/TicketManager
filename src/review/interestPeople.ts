import type { ReviewSnapshot } from './types';

// The synced contact register is the employee source for both fields. A Dataverse
// login is not required for a coordinator to record interest for an employee.
export function interestPeople(snapshot: ReviewSnapshot, onBehalfContactId: string) {
  const employees = snapshot.options.filter(c => c.type === 'employee');
  const own = employees.find(c => snapshot.contacts?.some(full => full.id === c.id && !!snapshot.persona.directoryId && full.directoryId === snapshot.persona.directoryId))
    ?? (snapshot.persona.role !== 'coordinator' ? employees[0] : undefined);
  const requester = onBehalfContactId ? employees.find(c => c.id === onBehalfContactId) : own;
  return { employees, own, requester };
}
