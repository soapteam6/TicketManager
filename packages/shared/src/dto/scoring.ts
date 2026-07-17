import { z } from 'zod';
import { FACTOR_KEYS } from '../enums.js';

const weightsShape = Object.fromEntries(
  FACTOR_KEYS.map((k) => [k, z.number()])
) as Record<(typeof FACTOR_KEYS)[number], z.ZodNumber>;

export const scoringWeightsSchema = z.object(weightsShape);

export const scoringParamsSchema = z.object({
  salesOppCapUsd: z.number().positive(),
  fairnessHalfLifeDays: z.number().positive(),
  leadTimeSweetSpotDays: z.number().positive(),
  leadTimeWindowDays: z.number().positive(),
  targetEmployeeShare: z.number().min(0).max(1),
});

export const createScoringConfigSchema = z.object({
  name: z.string().min(1),
  weights: scoringWeightsSchema,
  params: scoringParamsSchema,
  activate: z.boolean().optional(),
});
export type CreateScoringConfigInput = z.infer<typeof createScoringConfigSchema>;
