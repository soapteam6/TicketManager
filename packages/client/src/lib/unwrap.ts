// The server wraps resources under a key, e.g. { teams: [...] } or { game: {...} }.
// These helpers read either the wrapped or bare form so the client is resilient
// to minor contract drift.

export function pickArray<T>(data: unknown, ...keys: string[]): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    for (const key of keys) {
      const v = (data as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

export function pickObject<T>(data: unknown, ...keys: string[]): T | null {
  if (data && typeof data === 'object') {
    for (const key of keys) {
      const v = (data as Record<string, unknown>)[key];
      if (v && typeof v === 'object') return v as T;
    }
    // Fall back to the bare object if it has no wrapper keys.
    if (!keys.some((k) => k in (data as Record<string, unknown>))) return data as T;
  }
  return (data as T) ?? null;
}

// Parse a value that may be a JSON string or an already-parsed object.
export function parseMaybeJson<T>(value: T | string | null | undefined): T | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value;
}
