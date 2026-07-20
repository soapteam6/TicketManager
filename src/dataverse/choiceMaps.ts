// Two-way maps between our domain string enums (src/domain/enums.ts) and the numeric
// Dataverse choice option values used when the tables were created (see memory-bank.md).
import type {
  TransferPlatform,
  SeasonStatus,
  GameStatus,
  GameKind,
  SeatStatus,
  ContactType,
  ValueTier,
  FuturePriority,
  RequestStatus,
  RequestSource,
  AssignmentStatus,
  WaitlistStatus,
  TicketStatus,
  IntegrationAdapter,
  IntegrationStatus,
  ReservationStatus,
} from '../domain/enums';

interface ChoiceMap<T extends string> {
  // Returns `any` deliberately: each generated Dataverse model types its choice columns as a
  // literal union of that column's specific option codes, not plain `number` -- casting per
  // call site would be noisy, and this map already guarantees the value is valid for T.
  toCode(value: T): any;
  toValue(code: number): T;
}

function choiceMap<T extends string>(pairs: Array<[T, number]>): ChoiceMap<T> {
  const toCodeMap = new Map<T, number>(pairs);
  const toValueMap = new Map<number, T>(pairs.map(([value, code]) => [code, value]));
  return {
    toCode(value: T): any {
      const code = toCodeMap.get(value);
      if (code === undefined) throw new Error(`Unknown choice value: ${value}`);
      return code;
    },
    toValue(code: number): T {
      const value = toValueMap.get(code);
      if (value === undefined) throw new Error(`Unknown choice code: ${code}`);
      return value;
    },
  };
}

export const transferPlatformChoice = choiceMap<TransferPlatform>([
  ['mock', 100000000],
  ['ticketmaster', 100000001],
  ['axs', 100000002],
  ['seatgeek', 100000003],
]);

export const seasonStatusChoice = choiceMap<SeasonStatus>([
  ['draft', 100000000],
  ['active', 100000001],
  ['archived', 100000002],
  ['completed', 100000003],
]);

export const gameStatusChoice = choiceMap<GameStatus>([
  ['scheduled', 100000000],
  ['transfer_pending', 100000001],
  ['completed', 100000002],
  ['cancelled', 100000003],
]);

export const gameKindChoice = choiceMap<GameKind>([
  ['game', 100000000],
  ['event', 100000001],
]);

export const seatStatusChoice = choiceMap<SeatStatus>([
  ['available', 100000000],
  ['held', 100000001],
  ['assigned', 100000002],
  ['transferred', 100000003],
  ['cancelled', 100000004],
]);

export const contactTypeChoice = choiceMap<ContactType>([
  ['customer', 100000000],
  ['employee', 100000001],
]);

export const valueTierChoice = choiceMap<ValueTier>([
  ['platinum', 100000000],
  ['gold', 100000001],
  ['silver', 100000002],
  ['bronze', 100000003],
  ['prospect', 100000004],
]);

export const futurePriorityChoice = choiceMap<FuturePriority>([
  ['elevated', 100000000],
  ['normal', 100000001],
  ['deprioritized', 100000002],
]);

export const requestStatusChoice = choiceMap<RequestStatus>([
  ['submitted', 100000000],
  ['scored', 100000001],
  ['recommended', 100000002],
  ['approved', 100000003],
  ['partially_fulfilled', 100000004],
  ['fulfilled', 100000005],
  ['waitlisted', 100000006],
  ['declined', 100000007],
  ['cancelled', 100000008],
]);

export const requestSourceChoice = choiceMap<RequestSource>([
  ['manual', 100000000],
  ['email_intake', 100000001],
]);

export const assignmentStatusChoice = choiceMap<AssignmentStatus>([
  ['proposed', 100000000],
  ['approved', 100000001],
  ['transferred', 100000002],
  ['declined', 100000003],
  ['cancelled', 100000004],
]);

export const waitlistStatusChoice = choiceMap<WaitlistStatus>([
  ['active', 100000000],
  ['promoted', 100000001],
  ['expired', 100000002],
  ['cancelled', 100000003],
]);

export const ticketStatusChoice = choiceMap<TicketStatus>([
  ['accepted', 100000000],
  ['declined', 100000001],
  ['no_show', 100000002],
  ['attended', 100000003],
  ['cancelled', 100000004],
]);

export const integrationAdapterChoice = choiceMap<IntegrationAdapter>([
  ['ticketing', 100000000],
  ['email_intake', 100000001],
  ['narrative', 100000002],
  ['schedule_import', 100000003],
  ['crm', 100000004],
  ['directory', 100000005],
  ['notification', 100000006],
]);

export const reservationStatusChoice = choiceMap<ReservationStatus>([
  ['offered', 100000000],
  ['reserved', 100000001],
  ['expired', 100000002],
  ['released', 100000003],
]);

export const integrationStatusChoice = choiceMap<IntegrationStatus>([
  ['success', 100000000],
  ['error', 100000001],
  ['skipped', 100000002],
]);
