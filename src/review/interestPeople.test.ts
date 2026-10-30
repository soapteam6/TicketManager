import { describe, expect, it } from 'vitest';
import { MockReviewProvider } from './provider';
import { createFixtures, GUID, PERSONAS } from './fixtures';
import { interestPeople } from './interestPeople';
import type { CrmBeneficiary, ReviewCommand } from './types';

const command = (overrides: Partial<Extract<ReviewCommand, { type: 'interest' }>> = {}): ReviewCommand => ({
  type: 'interest', gameId: GUID(5, 2), purpose: 'customer', contactIds: [GUID(4, 1)], quantity: 1, rationale: 'Customer discussion', ...overrides,
});
const provider = () => new MockReviewProvider(() => Date.parse('2026-10-30T12:00:00Z'));
const crm: CrmBeneficiary = { contactId: GUID(21, 1), accountId: GUID(20, 1), accountName: 'CRM Example', name: 'CRM Person', email: 'crm@example.invalid', phone: '' };

describe('interest requester and beneficiaries', () => {
  it('resolves one employee beneficiary from a large employee register without email/name matching', () => {
    const state = createFixtures(), own = state.contacts.find(c => c.directoryId === PERSONAS.coordinator.directoryId)!;
    for (let n = 100; n < 400; n++) state.contacts.push({ ...own, id: GUID(4, n), directoryId: `other-${n}` });
    const p = new MockReviewProvider(undefined, undefined, state), s = p.snapshot('coordinator');
    expect(interestPeople(s, '').requester?.id).toBe(own.id);
    expect(interestPeople(s, GUID(4, 5)).requester?.id).toBe(GUID(4, 5));
    expect(interestPeople(s, 'missing').requester).toBeUndefined();
    expect(interestPeople(p.snapshot('employee'), '').requester?.id).toBe(GUID(4, 5));
  });
  it('records employee contact requesters without a Dataverse login and retains the real recorder', async () => {
    const p = provider();
    const result = await p.execute('coordinator', command({ onBehalfContactId: GUID(4, 5), purpose: 'employee', contactIds: [GUID(4, 5)] }));
    expect(p.snapshot('employee').requests.map(r => r.id)).toContain(result.id);
    expect(p.snapshot('rep').requests.map(r => r.id)).not.toContain(result.id);
    expect(p.snapshot('coordinator').requests.at(-1)).toMatchObject({ requesterName: 'Demo Employee', requesterEmail: 'employee@example.invalid', recordedById: PERSONAS.coordinator.id });
  });
  it('rejects extra self beneficiaries, inactive requesters and requester impersonation', async () => {
    const p = provider(), before = p.snapshot('coordinator');
    await expect(p.execute('coordinator', command({ purpose: 'employee', contactIds: [GUID(4, 4), GUID(4, 5)], quantity: 2, onBehalfContactId: GUID(4, 5) }))).rejects.toThrow('only the requesting person');
    await expect(p.execute('coordinator', command({ onBehalfContactId: GUID(4, 6) }))).rejects.toThrow('active employee');
    await expect(p.execute('rep', command({ onBehalfContactId: GUID(4, 5) }))).rejects.toThrow('Only coordinators');
    expect(p.snapshot('coordinator')).toEqual(before);
  });
  it('counts a person once across old login-based and new contact-based interest', async () => {
    const p = provider();
    await p.execute('employee', command({ purpose: 'employee', contactIds: [GUID(4, 5)] }));
    await p.execute('coordinator', command({ purpose: 'employee', contactIds: [GUID(4, 5)], onBehalfContactId: GUID(4, 5) }));
    expect(p.snapshot('coordinator').catalog.find(g => g.id === GUID(5, 2))).toMatchObject({ requestCount: 2, requestingPeople: 1 });
  });
});
describe('CRM customers in interest', () => {
  it('creates a reusable local customer and allocates to that exact recipient', async () => {
    const p = provider(), before = p.snapshot('coordinator').contacts!.length;
    const a = await p.execute('rep', command({ contactIds: [], crmContacts: [crm] }));
    await p.execute('rep', command({ contactIds: [], crmContacts: [crm] }));
    const s = p.snapshot('coordinator'), contact = s.contacts!.find(c => c.crmContactId === crm.contactId)!;
    expect(s.contacts).toHaveLength(before + 1);
    expect(contact).toMatchObject({ type: 'customer', crmAccountId: crm.accountId, tier: 'prospect' });
    await p.execute('coordinator', { type: 'allocate', requestId: a.id!, quantity: 1, reason: 'Customer visit approved' });
    expect(p.snapshot('coordinator').allocations!.find(x => x.requestId === a.id)?.contactId).toBe(contact.id);
  });
  it('rolls back mixed businesses, duplicate contacts and unauthorized employee customer requests', async () => {
    const p = provider(), before = p.snapshot('coordinator');
    for (const contacts of [[crm, { ...crm, contactId: GUID(21, 2), accountId: GUID(20, 2) }], [crm, crm]]) {
      await expect(p.execute('rep', command({ contactIds: [], crmContacts: contacts, quantity: 2 }))).rejects.toThrow();
    }
    await expect(p.execute('employee', command({ contactIds: [], crmContacts: [crm] }))).rejects.toThrow();
    expect(p.snapshot('coordinator')).toEqual(before);
  });
  it('preserves coordinator edits and never reactivates an inactive CRM contact', async () => {
    const p = provider();
    await p.execute('rep', command({ contactIds: [], crmContacts: [crm] }));
    const c = p.snapshot('coordinator').contacts!.find(x => x.crmContactId === crm.contactId)!;
    await p.execute('coordinator', { type: 'saveContact', id: c.id, contact: { ...c, name: 'Reviewed CRM Person', tier: 'gold' } });
    await p.execute('rep', command({ contactIds: [], crmContacts: [crm] }));
    expect(p.snapshot('coordinator').contacts!.find(x => x.id === c.id)).toMatchObject({ name: 'Reviewed CRM Person', tier: 'gold' });
    await p.execute('coordinator', { type: 'contactActive', contactId: c.id, active: false });
    const before = p.snapshot('coordinator');
    await expect(p.execute('rep', command({ contactIds: [], crmContacts: [crm] }))).rejects.toThrow('inactive');
    expect(p.snapshot('coordinator')).toEqual(before);
  });
});
