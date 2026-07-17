import { MicrosoftDataverseService } from '../generated/services/MicrosoftDataverseService';
import { Cr9cd_contact_beneficiariesService } from '../generated/services/Cr9cd_contact_beneficiariesService';
import { escapeODataString } from '../dataverse/bind';
import { contactTypeChoice } from '../dataverse/choiceMaps';

// The real CRM (accounts/contacts/opportunities) lives in a separate Dataverse environment
// ("DynamicsCRM", production) from the one this Code App is published in ("AIS Development").
// Native `-a dataverse` table binding only reaches the published environment, so this goes through
// the Microsoft Dataverse connector's cross-org "List rows from selected environment" action
// (ListRecordsWithOrganization) instead, which takes an explicit target org URL per call. Validated
// live against this exact org before building the picker UI on top of it (see memory-bank.md).
// Read-only: this file never writes to the DynamicsCRM org, only reads from it.
const DYNAMICS_CRM_ORG = 'https://org83e945f6.crm.dynamics.com';

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

// `revenue` is the "Manual Rep Credit" field (ais_manualrepcredit) -- the figure the sales org
// manually attributes to a rep for this opportunity, used as the ticket request's sales-opportunity value.
export interface CrmOpportunitySummary {
  id: string;
  name: string;
  manualRepCredit: number | null;
  estimatedValue: number | null;
}

async function listRecords<T = Record<string, unknown>>(entityName: string, select: string, filter: string, top = 25): Promise<T[]> {
  const result = await MicrosoftDataverseService.ListRecordsWithOrganization(
    DYNAMICS_CRM_ORG,
    entityName,
    undefined,
    undefined,
    undefined,
    undefined,
    select,
    filter,
    undefined,
    undefined,
    undefined,
    top
  );
  const value = (result.data as { value?: T[] } | undefined)?.value;
  return value ?? [];
}

export async function searchAccounts(query: string): Promise<CrmAccountSummary[]> {
  if (query.trim().length < 2) return [];
  const rows = await listRecords<{ accountid: string; name: string }>(
    'accounts',
    'name,accountid',
    `contains(name, '${escapeODataString(query)}')`,
    10
  );
  return rows.map((a) => ({ id: a.accountid, name: a.name }));
}

export async function listContactsForAccount(accountId: string): Promise<CrmContactSummary[]> {
  const rows = await listRecords<{
    contactid: string;
    fullname?: string;
    emailaddress1?: string;
    telephone1?: string;
    jobtitle?: string;
  }>('contacts', 'contactid,fullname,emailaddress1,telephone1,jobtitle', `_parentcustomerid_value eq ${accountId}`);
  return rows.map((c) => ({
    id: c.contactid,
    fullName: c.fullname ?? '(no name)',
    email: c.emailaddress1,
    phone: c.telephone1,
    title: c.jobtitle,
  }));
}

// Opportunities where this account is the potential customer (the polymorphic `customerid` lookup,
// Dynamics' standard "Potential Customer" field on Opportunity).
export async function listOpportunitiesForAccount(accountId: string): Promise<CrmOpportunitySummary[]> {
  const rows = await listRecords<{
    opportunityid: string;
    name?: string;
    ais_manualrepcredit?: number | null;
    estimatedvalue?: number | null;
  }>(
    'opportunities',
    'opportunityid,name,ais_manualrepcredit,estimatedvalue',
    `_customerid_value eq ${accountId} and statecode eq 0`
  );
  return rows.map((o) => ({
    id: o.opportunityid,
    name: o.name ?? '(unnamed opportunity)',
    manualRepCredit: o.ais_manualrepcredit ?? null,
    estimatedValue: o.estimatedvalue ?? null,
  }));
}

// Finds or creates the internal beneficiary-contact row linked to a CRM contact/account pair --
// ticket requests reference this row, never the CRM contact/account tables directly. This is the
// only write in this file, and it writes to our own AISDEV table, never to the DynamicsCRM org.
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
    filter: `cr9cd_directory_user_id eq '${escapeODataString(params.crmContactId)}'`,
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
    // The beneficiary's `Crm_Contact`/`Crm_Account` lookups point at the LOCAL environment's native
    // `contact`/`account` tables (a different Dataverse org than DynamicsCRM), so they can't reference
    // the cross-org CRM contact/account -- stash the real CRM contact id in the free-text
    // directory_user_id field instead, just to dedupe re-imports of the same CRM contact.
    cr9cd_directory_user_id: params.crmContactId,
  } as Parameters<typeof Cr9cd_contact_beneficiariesService.create>[0]);
  if (!created.data) throw new Error('Failed to create beneficiary contact');
  return created.data.cr9cd_contact_beneficiaryid;
}
