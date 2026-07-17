import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny } from 'zod';
import { badRequest } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

// Validate & coerce a request segment against a zod schema; replaces it with the parsed value.
export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      throw badRequest('Validation failed', result.error.flatten());
    }
    // params/query are read-only getters in Express 5 but writable in 4; assign defensively.
    (req as unknown as Record<Source, unknown>)[source] = result.data;
    next();
  };
}
