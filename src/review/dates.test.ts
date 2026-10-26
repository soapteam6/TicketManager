import { describe, expect, it } from 'vitest';
import {
  parseIsoTimestamp,
  isCalendarDate,
  utcDateTimeInputToIso,
  localDateTimeInputToIso,
  isoToLocalDateTimeInput,
  timeZoneLabel,
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
  it('shows a UTC instant in the viewer timezone without changing the stored instant', () => {
    expect(dateTime('2026-12-15T02:00:00Z', 'America/Los_Angeles')).toContain('Dec 14, 2026');
    expect(dateTime('2026-12-15T02:00:00Z', 'America/Los_Angeles')).toContain('18:00');
    expect(dateTime('2026-12-14T18:00:00-08:00', 'America/Los_Angeles')).toBe(
      dateTime('2026-12-15T02:00:00Z', 'America/Los_Angeles'),
    );
    expect(dateTime('2026-12-15T02:00:00Z', 'America/New_York')).toContain('21:00');
    expect(timeZoneLabel('America/Los_Angeles')).toBe('Pacific Time');
  });
  it.each([
    ['2026-09-29T19:30', 'America/Los_Angeles', '2026-09-30T02:30:00.000Z'],
    ['2027-01-09T19:00', 'America/Los_Angeles', '2027-01-10T03:00:00.000Z'],
    ['2026-09-29T22:30', 'America/New_York', '2026-09-30T02:30:00.000Z'],
    ['2027-01-01T00:15', 'Asia/Kolkata', '2026-12-31T18:45:00.000Z'],
  ])('round-trips local input %s in %s through UTC', (local, zone, iso) => {
    expect(localDateTimeInputToIso(local, zone)).toBe(iso);
    expect(isoToLocalDateTimeInput(iso, zone)).toBe(local);
  });
  it('rejects invalid dates and DST gaps/folds without normalizing or guessing', () => {
    for (const value of ['2026-02-30T19:00', '2027-03-14T02:30', '2027-11-07T01:30']) {
      expect(() => localDateTimeInputToIso(value, 'America/Los_Angeles')).toThrow();
    }
    expect(isoToLocalDateTimeInput('', 'America/Los_Angeles')).toBe('');
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
