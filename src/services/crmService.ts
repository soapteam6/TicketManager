import { AccountsService } from '../generated/services/AccountsService';
import { ContactsService } from '../generated/services/ContactsService';
import { Cr9cd_contact_beneficiariesService } from '../generated/services/Cr9cd_contact_beneficiariesService';
import { bindRef, escapeODataString } from '../dataverse/bind';
import { contactTypeChoice } from '../dataverse/choiceMaps';

// Native Dataverse account/contact tables -- this is the same environment the app's Dynamics 365
// CRM lives in, so no separate adapter/OAuth is needed (see plan doc). Note: this environment has
// no `opportunity` table (Sales isn't installed here), so there is no opportunity step here.

export interface CrmAccountSummary {
  id: string;
  name: string;
}

export interface CrmContactSummary {
  id: string;
  fullName: string;
  email?: string;
  phone?: string;
  title?: string;
}

export async function searchAccounts(query: string): Promise<CrmAccountSummary[]> {
  if (query.trim().length < 2) return [];
  const result = await AccountsService.getAll({
    filter: `contains(name, '${escapeODataString(query)}')`,
    select: ['accountid', 'name'],
    top: 10,
  });
  return (result.data ?? []).map((a) => ({ id: a.accountid, name: a.name }));
}

export async function listContactsForAccount(accountId: string): Promise<CrmContactSummary[]> {
  const result = await ContactsService.getAll({
    filter: `_parentcustomerid_value eq ${accountId}`,
    select: ['contactid', 'fullname', 'emailaddress1', 'telephone1', 'jobtitle'],
  });
  return (result.data ?? []).map((c) => ({
    id: c.contactid,
    fullName: c.fullname ?? '(no name)',
    email: c.emailaddress1,
    phone: c.telephone1,
    title: c.jobtitle,
  }));
}

// Finds or creates the internal beneficiary-contact row linked to a CRM contact/account pair --
// ticket requests reference this row, never the CRM contact/account tables directly.
export async function upsertBeneficiaryFromCrmContact(params: {
  crmContactId: string;
  crmAccountId: string;
  fullName: string;
  email?: string;
  phone?: string;
  title?: string;
  company?: string;
}): Promise<string> {
  const existing = await Cr9cd_contact_beneficiariesService.getAll({
    filter: `_cr9cd_crm_contact_value eq ${params.crmContactId}`,
    select: ['cr9cd_contact_beneficiaryid'],
    top: 1,
  });
  const already = existing.data?.[0];
  if (already) return already.cr9cd_contact_beneficiaryid;

  const created = await Cr9cd_contact_beneficiariesService.create({
    cr9cd_name: params.fullName,
    cr9cd_type: contactTypeChoice.toCode('customer'),
    cr9cd_email: params.email,
    cr9cd_phone: params.phone,
    cr9cd_title: params.title,
    cr9cd_company: params.company,
    'cr9cd_Crm_Contact@odata.bind': bindRef('contacts', params.crmContactId),
    'cr9cd_Crm_Account@odata.bind': bindRef('accounts', params.crmAccountId),
  } as Parameters<typeof Cr9cd_contact_beneficiariesService.create>[0]);
  if (!created.data) throw new Error('Failed to create beneficiary contact');
  return created.data.cr9cd_contact_beneficiaryid;
}
