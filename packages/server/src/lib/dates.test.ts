import { describe, expect, it } from 'vitest';
import { calendarDateSchema, isoTimestampSchema, parseIsoTimestamp, utcDateTimeInputToIso } from '@ais/shared';

describe('strict API timestamp contract', () => {
  it.each([
    '', ':00Z', '0', '2026-12-20', '2026-12-20T18:00', '2026-12-20T18:00:00',
    '2026-02-30T18:00:00Z', '2025-02-29T18:00:00Z', '1900-02-29T18:00:00Z',
    '2026-04-31T18:00:00Z', '2026-00-20T18:00:00Z', '2026-12-00T18:00:00Z',
    '2026-12-20T24:00:00Z', '2026-12-20T18:60:00Z', '2026-12-20T18:00:60Z',
    '2026-12-20T18:00:00+24:00', '2026-12-20T18:00:00+01:60', '2026-12-20T18:00:00+0100',
    '0000-12-20T18:00:00Z', '2026-12-20T18:00:00.1234Z', ' 2026-12-20T18:00:00Z ',
  ])('rejects malformed or impossible timestamp %j', (value) => {
    expect(parseIsoTimestamp(value)).toBeNull();
    expect(isoTimestampSchema.safeParse(value).success).toBe(false);
  });
  it('accepts actual leap days, milliseconds and explicit offsets without changing instants', () => {
    expect(parseIsoTimestamp('2000-02-29T18:00:00Z')).toBe(Date.parse('2000-02-29T18:00:00Z'));
    expect(parseIsoTimestamp('2028-02-29T18:00:00.123Z')).toBe(Date.parse('2028-02-29T18:00:00.123Z'));
    expect(parseIsoTimestamp('2026-12-20T18:00:00-08:00')).toBe(Date.parse('2026-12-21T02:00:00Z'));
    expect(parseIsoTimestamp('2026-12-20T18:00:00+09:00')).toBe(Date.parse('2026-12-20T09:00:00Z'));
  });
  it('validates the actual calendar for legacy date-only entry', () => {
    for (const value of ['2026-02-30', '1900-02-29', '2026-04-31', '2026-13-01', '2026-12-00']) expect(calendarDateSchema.safeParse(value).success).toBe(false);
    expect(calendarDateSchema.parse('2000-02-29')).toBe('2000-02-29');
    expect(calendarDateSchema.parse('2026-12-20')).toBe('2026-12-20');
  });
});

describe('native UTC date form conversion', () => {
  it('reads a complete minute/second value without concatenating a malformed fallback', () => {
    expect(utcDateTimeInputToIso('2026-12-20T18:00')).toBe('2026-12-20T18:00:00Z');
    expect(utcDateTimeInputToIso('2026-12-20T18:00:30')).toBe('2026-12-20T18:00:30Z');
    expect(utcDateTimeInputToIso('2026-12-20T18:00:30.125')).toBe('2026-12-20T18:00:30.125Z');
    for (const invalid of ['', null, undefined, ':00Z', '2026-02-30T18:00', '2026-12-20T24:00', '2026-12-20T18:00Z']) expect(() => utcDateTimeInputToIso(invalid)).toThrow('complete, valid date');
  });
});
