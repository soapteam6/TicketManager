import { Cr9cd_ticketrequestsService } from '../generated/services/Cr9cd_ticketrequestsService';
import { Cr9cd_assignmentsService } from '../generated/services/Cr9cd_assignmentsService';
import { deleteAssignment } from './assignmentsService';
import { assignmentStatusChoice } from '../dataverse/choiceMaps';
import type { AssignmentStatus } from '../domain/enums';

const ACTIVE_ASSIGNMENT_STATUSES: AssignmentStatus[] = ['proposed', 'approved', 'transferred'];

// Deletes every assignment tied to this request first (freeing their seats), then the request itself --
// a request can't be safely removed while it still has live seat holds pointing at it.
export async function deleteRequest(requestId: string): Promise<void> {
  const activeFilter = ACTIVE_ASSIGNMENT_STATUSES.map((s) => `cr9cd_status eq ${assignmentStatusChoice.toCode(s)}`).join(' or ');
  const assignmentsResult = await Cr9cd_assignmentsService.getAll({
    filter: `_cr9cd_ticket_request_value eq ${requestId} and (${activeFilter})`,
    select: ['cr9cd_assignmentid'],
  });
  for (const a of assignmentsResult.data ?? []) {
    await deleteAssignment(a.cr9cd_assignmentid);
  }
  await Cr9cd_ticketrequestsService.delete(requestId);
}
