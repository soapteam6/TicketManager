import type { FactorKey } from './enums.js';

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

// Default weights for the priority scoring engine (admin-editable via scoring_configs).
export const DEFAULT_SCORING_WEIGHTS: Record<FactorKey, number> = {
  strategicValue: 0.22,
  attendanceRate: 0.14,
  reliability: 0.12,
  salesOpportunity: 0.2,
  fairness: 0.14,
  employeeCustomerBalance: 0.06,
  leadTime: 0.06,
  premiumDemandBalance: 0.06,
};

export interface ScoringParams {
  salesOppCapUsd: number; // sales opportunity is normalized against this cap
  fairnessHalfLifeDays: number; // days-since-last-award half-life for the fairness curve
  leadTimeSweetSpotDays: number; // ideal lead time before a game (tent-function peak)
  leadTimeWindowDays: number; // width of the lead-time tent function
  targetEmployeeShare: number; // desired fraction of awards going to employees (0..1)
}

export const DEFAULT_SCORING_PARAMS: ScoringParams = {
  salesOppCapUsd: 50000,
  fairnessHalfLifeDays: 45,
  leadTimeSweetSpotDays: 21,
  leadTimeWindowDays: 60,
  targetEmployeeShare: 0.3,
};

export const FACTOR_LABELS: Record<FactorKey, string> = {
  strategicValue: 'Strategic Value',
  attendanceRate: 'Attendance Rate',
  reliability: 'Reliability (No-Show)',
  salesOpportunity: 'Sales Opportunity',
  fairness: 'Fairness (Time Since Last)',
  employeeCustomerBalance: 'Employee/Customer Balance',
  leadTime: 'Lead Time',
  premiumDemandBalance: 'Premium Demand Balance',
};
