import { describe, expect, it } from 'vitest';
import {
  parseIsoTimestamp,
  isCalendarDate,
  utcDateTimeInputToIso,
} from './dates';
import {
  dateOnlyToIso,
  isoToDateOnlyInput,
  formatDateOnly,
} from '../lib/format';
import { MockReviewProvider } from './provider';
import { GUID } from './fixtures';
import { dateTime } from './form';
describe('review ISO instants and preserved Code App date-only semantics', () => {
  it.each([
    ':00Z',
    '2000-01-01',
    '2026-12-20T18:00',
    '2026-02-30T18:00:00Z',
    '2026-12-20T25:00:00Z',
    '2026-12-20T18:00:60Z',
    '2026-12-20T18:00:00+24:00',
    '0000-01-01T00:00:00Z',
  ])('rejects malformed/normalized timestamp %s', async (input) => {
    expect(parseIsoTimestamp(input)).toBeNull();
    const p = new MockReviewProvider(() => Date.parse('2026-10-26T12:00:00Z'));
    await expect(
      p.execute('coordinator', {
        type: 'createInventory',
        kind: 'event',
        title: 'Invalid date fixture',
        gameDate: input,
        tickets: 2,
      }),
    ).rejects.toThrow('ISO');
  });
  it('accepts true leap days, seconds, offsets and milliseconds', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(parseIsoTimestamp('2026-12-20T18:00:00.123Z')).toBe(
      Date.parse('2026-12-20T18:00:00.123Z'),
    );
    expect(parseIsoTimestamp('2026-12-20T11:00:00-07:00')).toBe(
      parseIsoTimestamp('2026-12-20T18:00:00Z'),
    );
  });
  it('reads and validates the submitted datetime-local value in explicit UTC', async () => {
    expect(utcDateTimeInputToIso('2026-12-20T18:00')).toBe(
      '2026-12-20T18:00:00Z',
    );
    expect(() => utcDateTimeInputToIso(':00')).toThrow('complete');
    expect(() => utcDateTimeInputToIso('2026-02-30T18:00')).toThrow('valid');
    const p = new MockReviewProvider();
    await p.execute('coordinator', {
      type: 'createInventory',
      kind: 'event',
      title: 'Date QA fixture',
      gameDate: utcDateTimeInputToIso('2026-12-20T18:00'),
      tickets: 2,
    });
    expect(p.snapshot('coordinator').catalog.at(-1)?.gameDate).toBe(
      '2026-12-20T18:00:00Z',
    );
    expect(p.snapshot('coordinator').catalog.at(-1)?.seasonId).toBeNull();
  });
  it('keeps all review displays explicitly UTC without changing instants', () => {
    expect(dateTime('2026-12-15T02:00:00Z')).toContain('Dec 15, 2026');
    expect(dateTime('2026-12-15T02:00:00Z')).toContain('UTC');
    expect(dateTime('2026-12-14T18:00:00-08:00')).toBe(
      dateTime('2026-12-15T02:00:00Z'),
    );
  });
  it('preserves existing date-only calendar round trips in the process timezone', () => {
    expect(isoToDateOnlyInput(dateOnlyToIso('2026-12-20'))).toBe('2026-12-20');
    expect(formatDateOnly(dateOnlyToIso('2026-12-20'))).toContain('20');
    expect(isoToDateOnlyInput(dateOnlyToIso('2024-02-29'))).toBe('2024-02-29');
  });
  it('keeps season boundaries as calendar strings', async () => {
    const p = new MockReviewProvider();
    await p.execute('coordinator', {
      type: 'createSeason',
      teamId: GUID(2, 1),
      label: 'Calendar example',
      startDate: '2027-09-01',
      endDate: '2028-04-30',
    });
    expect(p.snapshot('coordinator').seasons.at(-1)?.startDate).toBe(
      '2027-09-01',
    );
  });
});
