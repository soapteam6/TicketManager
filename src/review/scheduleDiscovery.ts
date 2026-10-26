import { isCalendarDate, localDateTimeInputToIso, parseIsoTimestamp } from './dates';
import type { InventoryView, ScheduleSearchJob } from './types';

export interface ScheduleSource { url: string; title: string }
export interface DiscoveredGame {
  id: string;
  title: string;
  startAt: string;
  localDate: string;
  timezone: string;
  venue: string;
  home: boolean | null;
  sourceUrl: string;
  sourceVerified: boolean;
  timeIssue: string;
  tickets: number;
  selected: boolean;
}
export interface ScheduleDiscovery {
  team: string;
  season: string;
  timezone: string;
  seasonStart: string;
  seasonEnd: string;
  warnings: string[];
  sources: ScheduleSource[];
  games: DiscoveredGame[];
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function text(value: unknown, max = 500): string { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function scheduleObject(value: string): Record<string, unknown> | undefined {
  // Some tool-using responses put a prose preamble before their final JSON.
  // Extract balanced objects without treating braces inside JSON strings as syntax.
  let start = -1, depth = 0, quoted = false, escaped = false;
  const candidates: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (!depth) { if (char === '{') { start = index; depth = 1; quoted = false; escaped = false; } continue; }
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) candidates.push(value.slice(start, index + 1));
  }
  for (const candidate of candidates.reverse()) {
    try { const parsed = object(JSON.parse(candidate)); if (parsed && Array.isArray(parsed.games)) return parsed; } catch { /* Reject malformed candidates. */ }
  }
}
export function publicSourceUrl(value: unknown): string {
  try {
    const url = new URL(text(value, 2000));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.') || url.hostname.startsWith('[') || /^\d+(\.\d+){3}$/.test(url.hostname) || /(^localhost$|\.local$)/i.test(url.hostname)) return '';
    url.hash = ''; return url.href.replace(/\/$/, '');
  } catch { return ''; }
}
function verifiedStart(row: Record<string, unknown>, timezone: string): { startAt: string; issue: string; corrected?: boolean } {
  const raw = text(row.startAt, 80);
  const ms = parseIsoTimestamp(raw);
  if (ms === null) return { startAt: '', issue: 'Start time not confirmed' };
  const date = text(row.localDate, 10), time = text(row.localTime, 5);
  if (!isCalendarDate(date) || !/^\d{2}:\d{2}$/.test(time) || !timezone) return { startAt: '', issue: 'Source date/timezone not confirmed' };
  try {
    const startAt = localDateTimeInputToIso(`${date}T${time}`, timezone);
    return { startAt, issue: '', corrected: Date.parse(startAt) !== ms };
  } catch (error) { return { startAt: '', issue: error instanceof RangeError ? 'Source timezone is not recognized' : 'Source time is ambiguous or invalid during a timezone change' }; }
}

// Only actual Anthropic server-tool results count as verified sources. A URL in
// the model's final JSON cannot verify itself. No page content becomes executable UI.
export function parseScheduleDiscovery(raw: unknown, request: ScheduleSearchJob['request']): ScheduleDiscovery {
  const result = object(raw);
  if (!result || !Array.isArray(result.content)) throw new Error('The search returned no usable result. Try a more specific team and year.');
  if (result.stop_reason !== 'end_turn') throw new Error('The schedule search did not finish. Try a narrower date range.');
  const sources = new Map<string, ScheduleSource>();
  let searched = false, visited = 0;
  function visit(value: unknown, depth = 0) {
    if (depth > 20 || visited++ > 20000) return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    const row = object(value); if (!row) return;
    if (row.type === 'server_tool_use' && row.name === 'web_search') searched = true;
    if (['web_search_result', 'web_fetch_result', 'web_search_result_location'].includes(String(row.type))) {
      const url = publicSourceUrl(row.url);
      if (url) sources.set(url, { url, title: text(row.title) || new URL(url).hostname });
    }
    for (const [key, item] of Object.entries(row)) if (key !== 'text') visit(item, depth + 1);
  }
  visit(result.content);
  if (!searched || !sources.size) throw new Error('The search returned no verified web sources. Nothing is ready to import.');
  const blocks = result.content.map(object).filter((b): b is Record<string, unknown> => !!b && b.type === 'text' && typeof b.text === 'string');
  let parsed: Record<string, unknown> | undefined;
  for (const block of [...blocks].reverse()) {
    parsed = scheduleObject(String(block.text));
    if (parsed) break;
  }
  if (!parsed || !Array.isArray(parsed.games)) throw new Error('The search did not return a schedule table. Try naming the team and season year.');
  if (parsed.games.length > 400) throw new Error('The search returned too many events. Use a narrower date range.');
  const timezone = text(parsed.timezone, 100);
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.map(w => text(w)).filter(Boolean).slice(0, 20) : [];
  const seasonStart = isCalendarDate(text(parsed.seasonStart, 10)) ? text(parsed.seasonStart, 10) : '';
  const seasonEnd = isCalendarDate(text(parsed.seasonEnd, 10)) ? text(parsed.seasonEnd, 10) : '';
  const today = isCalendarDate(request.today || '') ? request.today! : new Date().toISOString().slice(0, 10);
  const wrongRelativeSeason = parsed.games.length > 0 && /\bnext\s+season\b/i.test(request.query) && (!seasonStart || seasonStart <= today);
  if (wrongRelativeSeason) warnings.unshift(`The returned ${text(parsed.season) || 'schedule'} was not confirmed as the next season after ${today}. Its games were withheld. Specify the intended season year and try again.`);
  let corrected = false;
  const games = parsed.games.map((value, index): DiscoveredGame => {
    const row = object(value) ?? {};
    const sourceUrl = publicSourceUrl(row.sourceUrl);
    const sourceVerified = sources.has(sourceUrl);
    const timing = verifiedStart(row, text(row.timezone, 100) || timezone);
    corrected ||= !!timing.corrected;
    const title = text(row.title, 200).replace(/[\r\n]+/g, ' ');
    const home = typeof row.home === 'boolean' ? row.home : null;
    return { id: String(index), title, startAt: timing.startAt, localDate: text(row.localDate, 10), timezone: text(row.timezone, 100) || timezone, venue: text(row.venue, 200), home,
      sourceUrl, sourceVerified, timeIssue: timing.issue, tickets: request.ticketsPerEvent,
      selected: !!title && sourceVerified && !!timing.startAt && (!request.homeOnly || home === true) };
  });
  if (corrected) warnings.push('UTC times were calculated from source local dates, times and timezones rather than the AI’s conversion.');
  return { team: text(parsed.team), season: text(parsed.season), timezone,
    seasonStart, seasonEnd, games: wrongRelativeSeason ? [] : games, sources: [...sources.values()], warnings: wrongRelativeSeason ? warnings.slice(0, 1) : warnings };
}
export function discoveredGameIssues(game: DiscoveredGame, catalog: InventoryView[], homeOnly: boolean): string[] {
  const issues: string[] = [];
  if (!game.title) issues.push('Title required');
  if (!game.sourceVerified) issues.push('Source was not verified by web search');
  if (!game.startAt || parseIsoTimestamp(game.startAt) === null) issues.push(game.timeIssue || 'Enter the confirmed start time');
  if (homeOnly && game.home !== true) issues.push('Not confirmed as a home game');
  if (!Number.isInteger(game.tickets) || game.tickets < 0 || game.tickets > 1000) issues.push('Use 0–1000 tickets');
  if (catalog.some(g => g.title.trim().toLowerCase() === game.title.trim().toLowerCase() && Date.parse(g.gameDate) === Date.parse(game.startAt))) issues.push('Already in inventory');
  return issues;
}
export function discoveredGamesCsv(games: DiscoveredGame[]): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return ['date,time,title,tickets,kind', ...games.map(g => {
    const instant = new Date(g.startAt).toISOString();
    return `${instant.slice(0, 10)},${instant.slice(11, 16)},${quote(g.title)},${g.tickets},game`;
  })].join('\n');
}
