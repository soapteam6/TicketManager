import type { Contact, CrmBeneficiary } from './types';

export const CRM_ORGANIZATION = 'https://org83e945f6.crm.dynamics.com';
export function prepareCrmPeople(contacts: Contact[], people: CrmBeneficiary[], id: () => string): Contact[] {
  const guid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const seen = new Set<string>();
  let account = '';
  return people.map(p => {
    if (!guid.test(p.contactId) || !guid.test(p.accountId)) throw new Error('Choose a valid CRM contact and business.');
    const contactId = p.contactId.toLowerCase(), accountId = p.accountId.toLowerCase();
    if (account && account !== accountId) throw new Error('Choose CRM contacts from one business.');
    account = accountId;
    if (seen.has(contactId)) throw new Error('Select each CRM contact once.');
    seen.add(contactId);
    if (!p.name.trim() || p.name.length > 200 || !p.accountName.trim() || p.accountName.length > 200 || p.email.length > 320 || p.phone.length > 100) throw new Error('CRM contact details are missing or too long.');
    const existing = contacts.find(c => c.crmOrganization === CRM_ORGANIZATION && c.crmContactId === contactId);
    if (existing) {
      if (existing.type !== 'customer' || !existing.appActive || !existing.directoryActive || existing.crmAccountId !== accountId) throw new Error('The saved CRM contact is inactive or belongs to a different business. Review Contacts & history.');
      return existing;
    }
    return { id: id(), type: 'customer', name: p.name.trim(), company: p.accountName.trim(), email: p.email.trim(), phone: p.phone.trim(), tier: 'prospect', appActive: true, directoryActive: true, directoryId: null, crmOrganization: CRM_ORGANIZATION, crmContactId: contactId, crmAccountId: accountId };
  });
}
