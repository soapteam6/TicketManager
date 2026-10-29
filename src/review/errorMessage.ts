const fallback = 'The change could not be saved. Refresh Dataverse and try again.';

// SDK failures may be Error instances, connector response objects, or JSON strings.
// Keep the server's validation reason instead of displaying "[object Object]".
export function reviewErrorMessage(error: unknown): string {
  const seen = new Set<object>();
  function read(value: unknown, depth = 0): string | undefined {
    if (depth > 8 || value == null) return;
    if (typeof value === 'string') {
      const message = value.trim();
      if (!message || message === '[object Object]') return;
      if (message.startsWith('{') || message.startsWith('[')) {
        try { return read(JSON.parse(message), depth + 1); } catch { /* Plain text. */ }
      }
      return message;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) { const message = read(entry, depth + 1); if (message) return message; }
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of ['innererror', 'innerError', 'error', 'body', 'response', 'data', 'details', 'message', 'Message', 'description']) {
      try {
        const message = read(record[key], depth + 1);
        if (message) return message;
      } catch { /* A broken SDK getter must not hide the remaining error. */ }
    }
  }
  const message = (read(error) ?? fallback).slice(0, 2000);
  if (/rowversion|version of the existing record|concurrencyversionmismatch/i.test(message)) {
    return 'Someone else updated the workspace. Refresh the data and review your changes before trying again.';
  }
  return message;
}
