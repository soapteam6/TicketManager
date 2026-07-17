import { eq, desc } from 'drizzle-orm';
import type { RecordAttendanceInput } from '@ais/shared';
import { db } from '../db/client.js';
import { attendanceRecords, assignments, contacts, games } from '../db/schema.js';
import { notFound, conflict } from '../lib/errors.js';

// Rebuild a contact's history rollups from its attendance records — idempotent, feeds scoring.
export function recomputeContactRollups(contactId: number): void {
  const rows = db
    .select({ rec: attendanceRecords, gameDate: games.gameDate })
    .from(attendanceRecords)
    .innerJoin(games, eq(attendanceRecords.gameId, games.id))
    .where(eq(attendanceRecords.contactId, contactId))
    .orderBy(desc(games.gameDate))
    .all();

  let attended = 0;
  let noShow = 0;
  let business = 0;
  let lastTicketDate: number | null = null;
  for (const { rec, gameDate } of rows) {
    business += rec.businessGenerated ?? 0;
    if (rec.ticketStatus === 'attended') attended++;
    if (rec.ticketStatus === 'no_show') noShow++;
    if ((rec.ticketStatus === 'attended' || rec.ticketStatus === 'accepted') && (lastTicketDate == null || gameDate > lastTicketDate)) {
      lastTicketDate = gameDate;
    }
  }
  const mostRecent = rows[0]?.rec.futurePriority ?? 'normal';

  db.update(contacts)
    .set({
      awardedCount: rows.length,
      attendedCount: attended,
      noShowCount: noShow,
      lifetimeBusinessGenerated: business,
      lastTicketDate,
      futurePriorityFlag: mostRecent,
      updatedAt: Date.now(),
    })
    .where(eq(contacts.id, contactId))
    .run();
}

export function recordAttendance(assignmentId: number, input: RecordAttendanceInput, userId: number) {
  const a = db.select().from(assignments).where(eq(assignments.id, assignmentId)).get();
  if (!a) throw notFound('Assignment not found');
  if (a.status !== 'transferred' && a.status !== 'approved') {
    throw conflict('Attendance can only be recorded for approved/transferred assignments');
  }

  const now = Date.now();
  const existing = db.select().from(attendanceRecords).where(eq(attendanceRecords.assignmentId, assignmentId)).get();

  const record = existing
    ? db
        .update(attendanceRecords)
        .set({
          ticketStatus: input.ticketStatus,
          designation: input.designation,
          salesRepUserId: input.salesRepUserId ?? null,
          businessGenerated: input.businessGenerated ?? 0,
          followUpNotes: input.followUpNotes ?? null,
          futurePriority: input.futurePriority ?? 'normal',
          updatedAt: now,
        })
        .where(eq(attendanceRecords.id, existing.id))
        .returning()
        .get()
    : db
        .insert(attendanceRecords)
        .values({
          assignmentId,
          gameId: a.gameId,
          contactId: a.beneficiaryContactId ?? null,
          ticketStatus: input.ticketStatus,
          designation: input.designation,
          salesRepUserId: input.salesRepUserId ?? null,
          businessGenerated: input.businessGenerated ?? 0,
          followUpNotes: input.followUpNotes ?? null,
          futurePriority: input.futurePriority ?? 'normal',
          recordedByUserId: userId > 0 ? userId : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

  if (a.beneficiaryContactId) recomputeContactRollups(a.beneficiaryContactId);
  return record;
}
