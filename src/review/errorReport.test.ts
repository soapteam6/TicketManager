import { describe, expect, it, vi, afterEach } from 'vitest';
import { createErrorReport } from './errorReport';
import { workspaceLoadMessage } from './workspaceLoading';

afterEach(() => vi.unstubAllGlobals());

describe('copyable error diagnostics', () => {
  it('keeps startup wording simple while preserving the original connector failure', () => {
    const original = { code: 'ConnectionAuthorizationFailed', message: 'AADSTS50173: Grant expired.', response: { status: 401, headers: { 'x-ms-request-id': 'request-123' } } };
    const error = new Error('Connector request failed', { cause: original });
    const report = createErrorReport(error, 'Load workspace', workspaceLoadMessage(error));
    expect(report.message).not.toContain('AADSTS');
    const details = JSON.parse(report.details);
    expect(details.action).toBe('Load workspace');
    expect(details.error.cause.code).toBe('ConnectionAuthorizationFailed');
    expect(details.error.cause.response.status).toBe(401);
    expect(details.error.cause.response.headers['x-ms-request-id']).toBe('request-123');
    expect(details.error.stack).toContain('Connector request failed');
    expect(Number.isFinite(Date.parse(details.occurredAt))).toBe(true);
  });

  it('retains the technical concurrency reason only in the copied report', () => {
    const report = createErrorReport(new Error('The version of the existing record does not match RowVersion.'), 'Save change: attendance');
    expect(report.message).toContain('Someone else updated');
    expect(report.message).not.toContain('RowVersion');
    expect(JSON.parse(report.details).error.message).toContain('RowVersion');
  });

  it('omits request bodies, credentials, app records and non-diagnostic headers', () => {
    const report = createErrorReport({
      message: 'Connector failed', config: { data: 'private request body', apiKey: 'secret-one' },
      response: { status: 403, data: { error: { code: 'Forbidden', message: 'Access denied' }, snapshot: 'private inventory', token: 'secret-two' }, headers: { Authorization: 'secret-three', 'set-cookie': 'secret-four', 'x-ms-request-id': 'request-456' } },
    }, 'Refresh workspace');
    expect(report.details).toContain('Forbidden');
    expect(report.details).toContain('request-456');
    expect(report.details).not.toMatch(/secret-|private |set-cookie|Authorization/);
  });

  it('filters JSON response bodies and redacts credentials embedded in text', () => {
    const key = 'sk-ant-synthetic-not-a-real-key';
    const jwt = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJleGFtcGxlIn0.signature';
    const report = createErrorReport({ body: JSON.stringify({ error: { message: `HTTP failed: x-api-key=${key}; Authorization: Bearer example-token; access_token="another-token"; ${jwt}; https://example.invalid/api?sig=url-secret#fragment` }, access_token: 'json-secret' }) }, 'Start AI Import');
    expect(report.details).not.toContain(key);
    for (const secret of [jwt, 'example-token', 'another-token', 'url-secret', 'json-secret', '#fragment']) expect(report.details).not.toContain(secret);
    expect(report.details).toContain('[redacted]');
    expect(report.details).toContain('https://example.invalid/api[parameters removed]');
  });

  it('excludes browser query strings and hash fragments', () => {
    vi.stubGlobal('location', { origin: 'https://app.example.invalid', pathname: '/index.html', search: '?token=page-secret', hash: '#access_token=hash-secret' });
    const report = createErrorReport('Failed', 'Load workspace');
    expect(JSON.parse(report.details).page).toBe('https://app.example.invalid/index.html');
    expect(report.details).not.toContain('secret');
  });

  it('handles circular errors, non-enumerable causes and unreadable SDK getters', () => {
    const error = new Error('Failed');
    Object.defineProperty(error, 'cause', { value: error });
    Object.defineProperty(error, 'response', { get() { throw new Error('Unreadable'); } });
    const report = createErrorReport(error, 'Refresh workspace');
    expect(JSON.parse(report.details).error.cause).toBe('[circular]');
    expect(report.details).not.toContain('Unreadable');
  });

  it('bounds large diagnostics while keeping the copy valid JSON', () => {
    const report = createErrorReport({ message: 'Failed', details: Array.from({ length: 30 }, () => 'x'.repeat(9000)) }, 'Load workspace');
    expect(JSON.parse(report.details).error.truncated).toBe(true);
    expect(report.details.length).toBeLessThan(32000);
    expect(createErrorReport(undefined, 'Save change').details).toContain('could not be saved');
  });
});
