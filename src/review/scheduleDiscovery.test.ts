import { describe, expect, it } from 'vitest';
import { discoveredGameIssues, discoveredGamesCsv, parseScheduleDiscovery, publicSourceUrl } from './scheduleDiscovery';
import { createFixtures } from './fixtures';

const request = { query: 'Example home schedule 2027', seasonId: 'season', ticketsPerEvent: 4, homeOnly: true };
const source = 'https://www.milb.com/las-vegas/schedule/2027-07';
function response(patch: Record<string, unknown> = {}) {
  return { stop_reason: 'end_turn', content: [
    { type: 'server_tool_use', name: 'web_search', id: 'search-1' },
    { type: 'web_search_tool_result', content: [{ type: 'web_search_result', title: 'Official team schedule', url: source }] },
    { type: 'text', text: JSON.stringify({ team: 'Example Team', season: '2027', timezone: 'America/Los_Angeles', warnings: [], games: [{ title: 'Example Opponent', localDate: '2027-07-04', localTime: '19:00', startAt: '2027-07-05T02:00:00Z', home: true, sourceUrl: source, ...patch }] }) },
  ] };
}
describe('schedule discovery result validation', () => {
  it('uses actual web-tool sources and validates summer timezone conversion', () => {
    const found = parseScheduleDiscovery(response(), request);
    expect(found.sources).toEqual([{ url: source, title: 'Official team schedule' }]);
    expect(found.games[0]).toMatchObject({ selected: true, startAt: '2027-07-05T02:00:00.000Z', tickets: 4 });
    expect(discoveredGameIssues(found.games[0], [], true)).toEqual([]);
  });
  it('extracts final schedule JSON after a tool-use preamble and ignores braces inside strings', () => {
    const raw = response({ title: 'Opponent {A}' });
    const block = raw.content.find(c => c.type === 'text')!;
    block.text = 'I checked the source. {"notASchedule":true}\n```json\n' + block.text + '\n```';
    expect(parseScheduleDiscovery(raw, request).games[0].title).toBe('Opponent {A}');
  });
  it('does not let a model verify its own invented URL', () => {
    const game = parseScheduleDiscovery(response({ sourceUrl: 'https://invented.example/schedule' }), request).games[0];
    expect(game.sourceVerified).toBe(false);
    expect(game.selected).toBe(false);
    expect(discoveredGameIssues(game, [], true)).toContain('Source was not verified by web search');
  });
  it('rejects an answer with no native web search results', () => {
    const raw = response(); raw.content = raw.content.filter(c => c.type === 'text');
    expect(() => parseScheduleDiscovery(raw, request)).toThrow('verified web sources');
  });
  it('keeps TBD times out instead of inventing midnight', () => {
    const game = parseScheduleDiscovery(response({ startAt: null, localTime: null }), request).games[0];
    expect(game.startAt).toBe(''); expect(game.selected).toBe(false);
    expect(discoveredGameIssues(game, [], true)).toContain('Start time not confirmed');
  });
  it('calculates UTC from source local time instead of the AI conversion', () => {
    const game = parseScheduleDiscovery(response({ startAt: '2027-07-05T03:00:00Z' }), request).games[0];
    expect(game.startAt).toBe('2027-07-05T02:00:00.000Z'); expect(game.timeIssue).toBe('');
    expect(parseScheduleDiscovery(response({ startAt: '2027-07-05T02:00:00-07:00' }), request).warnings.join(' ')).toContain('source local');
  });
  it('never guesses a repeated or skipped local time during a DST change', () => {
    for (const [localDate, localTime, startAt] of [['2027-11-07', '01:30', '2027-11-07T08:30:00Z'], ['2027-03-14', '02:30', '2027-03-14T10:30:00Z']]) {
      const game = parseScheduleDiscovery(response({ localDate, localTime, startAt }), request).games[0];
      expect(game.startAt).toBe(''); expect(game.selected).toBe(false);
    }
  });
  it('withholds a current-season substitution for a next-season request', () => {
    const raw = response();
    const block = raw.content.find(c => c.type === 'text')!;
    const parsed = JSON.parse(String(block.text)); parsed.seasonStart = '2026-09-01'; parsed.season = '2026-27'; block.text = JSON.stringify(parsed);
    const found = parseScheduleDiscovery(raw, { ...request, query: 'VGK next season', today: '2026-10-26' });
    expect(found.games).toEqual([]); expect(found.warnings.join(' ')).toContain('withheld');
  });
  it('keeps an unpublished future-season explanation when calendar bounds are unknown', () => {
    const raw = response(); const block = raw.content.find(c => c.type === 'text')!;
    block.text = JSON.stringify({ team: 'Example team', season: '2027-28', seasonStart: null, seasonEnd: null, games: [], warnings: ['The 2027-28 schedule is not published.'] });
    const found = parseScheduleDiscovery(raw, { ...request, query: 'next season', today: '2026-10-26' });
    expect(found.games).toEqual([]); expect(found.warnings).toEqual(['The 2027-28 schedule is not published.']);
  });
  it('handles winter offset separately from summer', () => {
    const game = parseScheduleDiscovery(response({ localDate: '2027-01-09', localTime: '19:00', startAt: '2027-01-10T03:00:00Z' }), request).games[0];
    expect(game.selected).toBe(true);
  });
  it('excludes unverified home/away and away games from a home-only search', () => {
    for (const home of [false, null]) {
      const game = parseScheduleDiscovery(response({ home }), request).games[0];
      expect(game.selected).toBe(false);
      expect(discoveredGameIssues(game, [], true)).toContain('Not confirmed as a home game');
    }
  });
  it('flags existing inventory even if its ISO formatting differs', () => {
    const game = parseScheduleDiscovery(response(), request).games[0];
    const catalog = [{ ...createFixtures().games[0], title: 'EXAMPLE OPPONENT', gameDate: '2027-07-05T02:00:00Z', availableTickets: 4, requestCount: 0, requestingPeople: 0, requestedTickets: 0, released: false }];
    expect(discoveredGameIssues(game, catalog, true)).toContain('Already in inventory');
  });
  it('rejects paused or truncated responses', () => {
    for (const stop_reason of ['pause_turn', 'max_tokens']) expect(() => parseScheduleDiscovery({ ...response(), stop_reason }, request)).toThrow('did not finish');
  });
  it('escapes quotes and normalizes line breaks in CSV titles', () => {
    const game = parseScheduleDiscovery(response({ title: 'A "quoted"\nopponent' }), request).games[0];
    expect(discoveredGamesCsv([game])).toContain('2027-07-05,02:00,"A ""quoted"" opponent",4,game');
  });
  it('blocks credential-bearing, executable and private source links', () => {
    for (const url of ['javascript:alert(1)', 'https://user:password@example.com/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://host.local/']) expect(publicSourceUrl(url)).toBe('');
  });
});
