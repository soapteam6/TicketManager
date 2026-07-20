import { Cr9cd_attendancerecordsService } from '../generated/services/Cr9cd_attendancerecordsService';
import { Cr9cd_assignmentsService } from '../generated/services/Cr9cd_assignmentsService';
import { Cr9cd_contact_beneficiariesService } from '../generated/services/Cr9cd_contact_beneficiariesService';
import { bindRef } from '../dataverse/bind';
import { ticketStatusChoice, contactTypeChoice, futurePriorityChoice } from '../dataverse/choiceMaps';
import type { TicketStatus, ContactType, FuturePriority } from '../domain/enums';

export interface RecordAttendanceInput {
  assignmentId: string;
  ticketStatus: TicketStatus;
  // Optional -- defaults to the beneficiary contact's type (employee/customer) when omitted.
  designation?: ContactType;
  businessGenerated: number;
  followUpNotes?: string;
  futurePriority?: FuturePriority;
  salesRepUserId?: string;
}

// Upserts one attendance record per assignment, then rebuilds the beneficiary's rollup stats --
// this is the ROI-reconciliation -> scoring feedback loop (attendanceRate/reliability/fairness factors).
export async function recordAttendance(input: RecordAttendanceInput): Promise<void> {
  const assignmentResult = await Cr9cd_assignmentsService.get(input.assignmentId);
  const assignment = assignmentResult.data;
  if (!assignment) throw new Error('Assignment not found');

  const gameId = assignment._cr9cd_game_value;
  const contactId = assignment._cr9cd_beneficiary_contact_value;
  if (!gameId) throw new Error('Assignment is missing its game');

  const existing = await Cr9cd_attendancerecordsService.getAll({
    filter: `_cr9cd_assignment_value eq ${input.assignmentId}`,
    select: ['cr9cd_attendancerecordid'],
    top: 1,
  });

  // Resolve designation: caller-supplied, else the beneficiary's contact type, else 'customer'.
  let designation = input.designation;
  if (!designation) {
    if (contactId) {
      const contactResult = await Cr9cd_contact_beneficiariesService.get(contactId, { select: ['cr9cd_type'] });
      designation = contactResult.data?.cr9cd_type != null ? contactTypeChoice.toValue(contactResult.data.cr9cd_type) : 'customer';
    } else {
      designation = 'customer';
    }
  }

  const fields = {
    cr9cd_ticket_status: ticketStatusChoice.toCode(input.ticketStatus),
    cr9cd_designation: contactTypeChoice.toCode(designation),
    cr9cd_business_generated: input.businessGenerated,
    cr9cd_follow_up_notes: input.followUpNotes,
    ...(input.futurePriority ? { cr9cd_future_priority: futurePriorityChoice.toCode(input.futurePriority) } : {}),
    ...(input.salesRepUserId ? { 'cr9cd_Sales_Rep@odata.bind': bindRef('systemusers', input.salesRepUserId) } : {}),
  };

  const already = existing.data?.[0];
  if (already) {
    await Cr9cd_attendancerecordsService.update(already.cr9cd_attendancerecordid, fields);
  } else {
    await Cr9cd_attendancerecordsService.create({
      'cr9cd_Assignment@odata.bind': bindRef('cr9cd_assignments', input.assignmentId),
      'cr9cd_Game@odata.bind': bindRef('cr9cd_games', gameId),
      ...(contactId ? { 'cr9cd_Beneficiary_Contact@odata.bind': bindRef('cr9cd_contact_beneficiaries', contactId) } : {}),
      ...fields,
    } as Parameters<typeof Cr9cd_attendancerecordsService.create>[0]);
  }

  if (contactId) {
    await recomputeContactRollups(contactId);
  }
}

// Rebuilds attendedCount/noShowCount/awardedCount/lifetimeBusinessGenerated/lastTicketDate/
// futurePriorityFlag from the beneficiary's full attendance history. awardedCount = every
// attendance record (each represents one ticket the beneficiary was actually awarded).
export async function recomputeContactRollups(contactId: string): Promise<void> {
  const recordsResult = await Cr9cd_attendancerecordsService.getAll({
    filter: `_cr9cd_beneficiary_contact_value eq ${contactId}`,
    orderBy: ['createdon desc'],
  });
  const records = recordsResult.data ?? [];

  let attendedCount = 0;
  let noShowCount = 0;
  let lifetimeBusinessGenerated = 0;
  for (const record of records) {
    const status = record.cr9cd_ticket_status != null ? ticketStatusChoice.toValue(record.cr9cd_ticket_status) : undefined;
    if (status === 'attended') attendedCount++;
    if (status === 'no_show') noShowCount++;
    lifetimeBusinessGenerated += record.cr9cd_business_generated ?? 0;
  }

  const mostRecent = records[0];

  await Cr9cd_contact_beneficiariesService.update(contactId, {
    cr9cd_attended_count: attendedCount,
    cr9cd_no_show_count: noShowCount,
    cr9cd_awarded_count: records.length,
    cr9cd_lifetime_business_generated: lifetimeBusinessGenerated,
    ...(mostRecent?.createdon ? { cr9cd_last_ticket_date: mostRecent.createdon } : {}),
    ...(mostRecent?.cr9cd_future_priority != null ? { cr9cd_future_priority_flag: mostRecent.cr9cd_future_priority } : {}),
  });
}
