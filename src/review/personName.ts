import type { InterestView, ReviewSnapshot } from './types';

// Presentation only: preserve the original Dataverse name and identity in storage.
// A # prefix alone is not sufficient to classify an account as an application user.
export function personName(name: string): string {
  return name.replace(/^\s*#+\s*/, '').trim() || name.trim();
}

export function beneficiaryNames(request: InterestView, snapshot: ReviewSnapshot): string {
  if (request.contactIds && snapshot.contacts) {
    return request.contactIds.map(id => {
      const contact = snapshot.contacts?.find(c => c.id === id);
      return contact ? personName(contact.name) : 'Historical contact';
    }).join(', ');
  }
  return personName(request.contactNames);
}
