import { TIER_RANK, MAX_TIER_RANK, type FactorKey } from '../domain/enums';
import type { Factor, FactorOutput } from './types';

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const DAY_MS = 24 * 60 * 60 * 1000;

function out(raw: number | null, norm: number, explain: string): FactorOutput {
  return { raw, norm: clamp01(norm), explain };
}

// Strategic value from the beneficiary tier, nudged by the future-priority flag.
const strategicValue: Factor = {
  key: 'strategicValue',
  extract(req) {
    const base = (TIER_RANK[req.tier] - 1) / (MAX_TIER_RANK - 1);
    const nudge = req.futurePriorityFlag === 'elevated' ? 0.15 : req.futurePriorityFlag === 'deprioritized' ? -0.2 : 0;
    return out(TIER_RANK[req.tier], base + nudge, `${req.tier} tier${nudge ? ` (${req.futurePriorityFlag})` : ''}`);
  },
};

// Share of prior awards actually attended. New beneficiaries get a neutral prior.
const attendanceRate: Factor = {
  key: 'attendanceRate',
  extract(req) {
    if (req.awardedCount <= 0) return out(null, 0.5, 'No history (neutral)');
    const rate = req.attendedCount / req.awardedCount;
    return out(rate, rate, `Attended ${req.attendedCount}/${req.awardedCount} prior awards`);
  },
};

// Reliability = inverse no-show rate (models the "no-show penalty" as positive goodness).
const reliability: Factor = {
  key: 'reliability',
  extract(req) {
    if (req.awardedCount <= 0) return out(null, 1, 'No no-shows on record');
    const noShowRate = req.noShowCount / req.awardedCount;
    return out(noShowRate, 1 - noShowRate, `${req.noShowCount} no-shows of ${req.awardedCount}`);
  },
};

// Potential business, capped so a single large deal cannot dominate.
const salesOpportunity: Factor = {
  key: 'salesOpportunity',
  extract(req, ctx) {
    const cap = ctx.config.params.salesOppCapUsd;
    const norm = Math.min(req.salesOpportunityUsd, cap) / cap;
    return out(req.salesOpportunityUsd, norm, req.salesOpportunityUsd > 0 ? `$${Math.round(req.salesOpportunityUsd).toLocaleString()} potential` : 'No stated opportunity');
  },
};

// Fairness rises the longer since this beneficiary last received tickets.
const fairness: Factor = {
  key: 'fairness',
  extract(req, ctx) {
    if (req.lastTicketDate == null) return out(null, 1, 'Never awarded before');
    const days = Math.max(0, (ctx.now - req.lastTicketDate) / DAY_MS);
    const norm = 1 - Math.pow(0.5, days / ctx.config.params.fairnessHalfLifeDays);
    return out(Math.round(days), norm, `${Math.round(days)} days since last award`);
  },
};

// Pool-aware: boosts whichever class (employee/customer) is under its target share.
const employeeCustomerBalance: Factor = {
  key: 'employeeCustomerBalance',
  extract(req, ctx) {
    if (!req.contactType || ctx.pool.total === 0) return out(null, 0.5, 'Balanced');
    const isEmployee = req.contactType === 'employee';
    const classCount = isEmployee ? ctx.pool.employeeCount : ctx.pool.customerCount;
    const currentShare = classCount / ctx.pool.total;
    const desiredShare = isEmployee ? ctx.config.params.targetEmployeeShare : 1 - ctx.config.params.targetEmployeeShare;
    const norm = 0.5 + (desiredShare - currentShare);
    return out(Number(currentShare.toFixed(2)), norm, isEmployee ? 'Employee mix' : 'Customer mix');
  },
};

// Tent function: rewards requests submitted around the ideal lead time before the game.
const leadTime: Factor = {
  key: 'leadTime',
  extract(req, ctx) {
    const days = (ctx.game.gameDate - req.createdAt) / DAY_MS;
    const { leadTimeSweetSpotDays, leadTimeWindowDays } = ctx.config.params;
    const norm = 1 - Math.abs(days - leadTimeSweetSpotDays) / (leadTimeWindowDays / 2);
    return out(Math.round(days), norm, `${Math.round(days)} days lead time`);
  },
};

// Damps concentration of premium games on the highest-tier beneficiaries.
const premiumDemandBalance: Factor = {
  key: 'premiumDemandBalance',
  extract(req, ctx) {
    const tierNorm = (TIER_RANK[req.tier] - 1) / (MAX_TIER_RANK - 1);
    const norm = 1 - ctx.game.premiumScore * tierNorm;
    return out(Number(ctx.game.premiumScore.toFixed(2)), norm, ctx.game.premiumScore >= 0.66 ? 'Premium game balancing' : 'Standard demand');
  },
};

export const FACTORS: Record<FactorKey, Factor> = {
  strategicValue,
  attendanceRate,
  reliability,
  salesOpportunity,
  fairness,
  employeeCustomerBalance,
  leadTime,
  premiumDemandBalance,
};
