// Central enums used across the app (Dataverse Choice columns map to these).

export const SEASON_STATUS = ['draft', 'active', 'completed', 'archived'] as const;
export type SeasonStatus = (typeof SEASON_STATUS)[number];
// Statuses surfaced as filters in the games list (default 'active').
export const SEASON_FILTER_STATUS = ['active', 'completed'] as const;

export const GAME_STATUS = ['scheduled', 'transfer_pending', 'completed', 'cancelled'] as const;
export type GameStatus = (typeof GAME_STATUS)[number];

export const GAME_KIND = ['game', 'event'] as const;
export type GameKind = (typeof GAME_KIND)[number];

export const SEAT_STATUS = ['available', 'held', 'assigned', 'transferred', 'cancelled'] as const;
export type SeatStatus = (typeof SEAT_STATUS)[number];

export const CONTACT_TYPE = ['customer', 'employee'] as const;
export type ContactType = (typeof CONTACT_TYPE)[number];

export const VALUE_TIER = ['platinum', 'gold', 'silver', 'bronze', 'prospect'] as const;
export type ValueTier = (typeof VALUE_TIER)[number];

// Numeric weight per tier (higher = more strategic value). Drives scoring normalization.
export const TIER_RANK: Record<ValueTier, number> = {
  platinum: 5,
  gold: 4,
  silver: 3,
  bronze: 2,
  prospect: 1,
};
export const MAX_TIER_RANK = 5;

export const FUTURE_PRIORITY = ['elevated', 'normal', 'deprioritized'] as const;
export type FuturePriority = (typeof FUTURE_PRIORITY)[number];

export const REQUEST_STATUS = [
  'submitted',
  'scored',
  'recommended',
  'approved',
  'partially_fulfilled',
  'fulfilled',
  'waitlisted',
  'declined',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUS)[number];

export const REQUEST_SOURCE = ['manual', 'email_intake'] as const;
export type RequestSource = (typeof REQUEST_SOURCE)[number];

export const ASSIGNMENT_STATUS = ['proposed', 'approved', 'transferred', 'declined', 'cancelled'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUS)[number];
// Statuses that actively hold a seat (used by the seat double-booking guard).
export const ACTIVE_ASSIGNMENT_STATUSES: AssignmentStatus[] = ['proposed', 'approved', 'transferred'];

export const WAITLIST_STATUS = ['active', 'promoted', 'expired', 'cancelled'] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUS)[number];

export const TICKET_STATUS = ['accepted', 'declined', 'no_show', 'attended', 'cancelled'] as const;
export type TicketStatus = (typeof TICKET_STATUS)[number];
// The simplified attendance-reconcile outcome set (subset of TICKET_STATUS).
export const ATTENDANCE_OUTCOMES = ['attended', 'no_show', 'cancelled'] as const;
export type AttendanceOutcome = (typeof ATTENDANCE_OUTCOMES)[number];

export const RESERVATION_STATUS = ['offered', 'reserved', 'expired', 'released'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUS)[number];
// Reservation statuses that actively hold a seat.
export const ACTIVE_RESERVATION_STATUSES: ReservationStatus[] = ['offered', 'reserved'];

// Broadcast audiences for the "send availability" distribution feature.
export const NOTIFY_AUDIENCE = ['everyone', 'sales_team'] as const;
export type NotifyAudience = (typeof NOTIFY_AUDIENCE)[number];

// Notification Manager (cr9cd_notification / cr9cd_notificationtemplate) choice sets.
export const NOTIFICATION_TYPE = ['reminder', 'announcement', 'availability', 'game_link'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPE)[number];

export const NOTIFICATION_CHANNEL = ['email', 'sms', 'in_app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[number];

export const NOTIFICATION_AUDIENCE = ['everyone', 'sales_team', 'employees', 'holders'] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCE)[number];

export const NOTIFICATION_STATUS = ['draft', 'scheduled', 'sent'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUS)[number];

export const TRANSFER_PLATFORM = ['ticketmaster', 'axs', 'seatgeek', 'mock'] as const;
export type TransferPlatform = (typeof TRANSFER_PLATFORM)[number];

export const INTEGRATION_ADAPTER = ['ticketing', 'email_intake', 'narrative', 'schedule_import', 'crm', 'directory', 'notification'] as const;
export type IntegrationAdapter = (typeof INTEGRATION_ADAPTER)[number];

export const INTEGRATION_STATUS = ['success', 'error', 'skipped'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUS)[number];

export const FACTOR_KEYS = [
  'strategicValue',
  'attendanceRate',
  'reliability',
  'salesOpportunity',
  'fairness',
  'employeeCustomerBalance',
  'leadTime',
  'premiumDemandBalance',
] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];
