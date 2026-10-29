import { reviewErrorMessage } from './errorMessage';

export interface ErrorReport {
  message: string;
  details: string;
}

// Copy diagnostic fields only: never serialize a request, app state, credentials or
// an entire connector response. Error properties are often non-enumerable.
const fields = new Set([
  'name', 'message', 'description', 'stack', 'code', 'errorcode', 'errortype',
  'status', 'statuscode', 'source', 'requestid', 'clientrequestid',
  'correlationid', 'activityid', 'traceid', 'timestamp',
  'error', 'innererror', 'cause', 'body', 'response', 'data', 'details',
]);
const requestHeaders = new Set(['request-id', 'x-ms-request-id', 'x-ms-client-request-id', 'x-ms-correlation-request-id', 'x-ms-service-request-id', 'activityid']);

function redact(text: string): string {
  return text
    .replace(/\b(?:https?:\/\/)[^\s<>"']+/gi, url => url.replace(/[?#].*$/, '[parameters removed]'))
    .replace(/\bBearer\s+[^\s,"';]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-ant-[\w-]+/g, '[redacted]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]')
    .replace(/(["']?(?:authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]');
}

function diagnosticFields(error: unknown): unknown {
  const seen = new Set<object>();
  let remaining = 200;
  function read(value: unknown, depth = 0): unknown {
    if (--remaining < 0) return '[size limit]';
    if (depth > 8) return '[depth limit]';
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { return read(JSON.parse(trimmed), depth + 1); } catch { /* Plain error text. */ }
      }
      return redact(value).slice(0, 8000);
    }
    if (typeof value !== 'object') return undefined;
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 20).map(entry => read(entry, depth + 1));
    const result: Record<string, unknown> = {};
    for (const key of new Set([...Object.getOwnPropertyNames(value), 'name', 'message', 'stack', 'cause'])) {
      const normalized = key.replace(/[-_]/g, '').toLowerCase();
      if (!fields.has(normalized) && normalized !== 'headers') continue;
      // Some SDK error properties are getters; a broken getter must not hide
      // the original failure or prevent copying the remaining diagnostics.
      try {
        const entry = (value as Record<string, unknown>)[key];
        if (normalized === 'headers' && entry && typeof entry === 'object') {
          const ids: Record<string, unknown> = {};
          for (const header of requestHeaders) {
            const headerValue = entry instanceof Headers ? entry.get(header)
              : Object.entries(entry).find(([name]) => name.toLowerCase() === header)?.[1];
            if (headerValue != null) ids[header] = read(headerValue, depth + 1);
          }
          if (Object.keys(ids).length) result[key] = ids;
        } else if (entry !== undefined) result[key] = read(entry, depth + 1);
      } catch { /* Skip unreadable SDK properties. */ }
    }
    return result;
  }
  return read(error);
}

export function createErrorReport(error: unknown, action: string, message = reviewErrorMessage(error)): ErrorReport {
  const report = {
    app: 'AIS Ticket Manager',
    action,
    occurredAt: new Date().toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    page: typeof location === 'undefined' ? undefined : location.origin + location.pathname,
    browser: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
    message: redact(message),
    error: diagnosticFields(error),
  };
  const details = JSON.stringify(report, null, 2);
  if (details.length <= 32000) return { message, details };
  return { message, details: JSON.stringify({ ...report, error: { truncated: true, preview: JSON.stringify(report.error).slice(0, 16000) } }, null, 2) };
}
