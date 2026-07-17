import { z } from 'zod';

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ISO date (YYYY-MM-DD) or full ISO datetime accepted; stored as unix-ms on the server.
export const isoDate = z.string().min(1);
