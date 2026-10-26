import type { FactorKey } from './enums';

// The four teams AIS holds season tickets for, with annual home-game counts.
export interface TeamSeed {
  name: string;
  abbreviation: string;
  sport: string;
  venue: string;
  homeGamesPerSeason: number;
  defaultPlatform: 'ticketmaster' | 'axs' | 'seatgeek';
}

export const TEAM_SEEDS: TeamSeed[] = [
  {
    name: 'Vegas Golden Knights',
    abbreviation: 'VGK',
    sport: 'NHL Hockey',
    venue: 'T-Mobile Arena',
    homeGamesPerSeason: 42,
    defaultPlatform: 'ticketmaster',
  },
  {
    name: 'Las Vegas Aviators',
    abbreviation: 'LVA',
    sport: 'MiLB Baseball',
    venue: 'Las Vegas Ballpark',
    homeGamesPerSeason: 75,
    defaultPlatform: 'axs',
  },
  {
    name: 'Las Vegas Lights FC',
    abbreviation: 'LVL',
    sport: 'USL Soccer',
    venue: 'Cashman Field',
    homeGamesPerSeason: 17,
    defaultPlatform: 'seatgeek',
  },
  {
    name: 'Vegas Desert Dogs',
    abbreviation: 'VDD',
    sport: 'NLL Lacrosse',
    venue: 'Michelob Ultra Arena',
    homeGamesPerSeason: 9,
    defaultPlatform: 'ticketmaster',
  },
];

// Transparent demonstration defaults for advisory ranking; not settled numeric business policy.
export const DEFAULT_SCORING_WEIGHTS: Record<FactorKey, number> = {
  strategicValue: 0.35,
  attendanceRate: 0,
  reliability: 0.15,
  salesOpportunity: 0.25,
  fairness: 0.25,
  employeeCustomerBalance: 0,
  leadTime: 0,
  premiumDemandBalance: 0,
};

export interface ScoringParams {
  categoryCustomerScore?: number;
  categoryProspectScore?: number;
  categoryEmployeeScore?: number;
  salesOppCapUsd: number; // retained legacy configuration field; rationale factor does not use a financial cap
  fairnessHalfLifeDays: number; // days-since-last-award half-life for the fairness curve
  leadTimeSweetSpotDays: number; // ideal lead time before a game (tent-function peak)
  leadTimeWindowDays: number; // width of the lead-time tent function
  targetEmployeeShare: number; // desired fraction of awards going to employees (0..1)
}

export const DEFAULT_SCORING_PARAMS: ScoringParams = {
  categoryCustomerScore: 0.8,
  categoryProspectScore: 0.7,
  categoryEmployeeScore: 0.2,
  salesOppCapUsd: 50000,
  fairnessHalfLifeDays: 45,
  leadTimeSweetSpotDays: 21,
  leadTimeWindowDays: 60,
  targetEmployeeShare: 0.3,
};

export const FACTOR_LABELS: Record<FactorKey, string> = {
  strategicValue: 'Customer / prospect / employee category',
  attendanceRate: 'Attendance Rate',
  reliability: 'Reliability (No-Show)',
  salesOpportunity: 'Business rationale / opportunity',
  fairness: 'Fairness within the season',
  employeeCustomerBalance: 'Employee/Customer Balance',
  leadTime: 'Lead Time',
  premiumDemandBalance: 'Premium Demand Balance',
};
