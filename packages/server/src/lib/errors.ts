// Typed HTTP errors so services can throw and the error middleware maps to status codes.
export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg = 'Bad request', details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Unauthorized') => new HttpError(401, msg);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg = 'Conflict', details?: unknown) => new HttpError(409, msg, details);

// Recognize SQLite unique-constraint violations (used by the seat-integrity guarantee).
export function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}
