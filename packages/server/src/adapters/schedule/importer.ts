import Anthropic from '@anthropic-ai/sdk';
import type { ExtractedGame } from '@ais/shared';
import { env } from '../../env.js';
import { logger } from '../../lib/logger.js';

const MODEL = 'claude-sonnet-4-6';

// Stable instructions — cached so repeated parses reuse the prefix.
const PARSE_SYSTEM = `You turn a pasted sports schedule (copied from a team's official site) into structured JSON.
RULES:
- HOME games only. Exclude away games and past games; include the full home slate present in the text.
- Each home game: date + local START TIME as ISO 8601 (e.g. "2026-10-14T19:00:00"); if the start time
  isn't shown, use the date with "T00:00:00". Also the opponent, and any promotion/theme note if present.
- Use the times as written; do not convert time zones. Infer the year from context if it isn't on each line.
OUTPUT: ONLY a JSON array (no prose, no code fences): {"gameDate":"<ISO>","opponent":"<string>","promotions":"<string or null>"}.
If there is no home schedule in the text, respond with exactly [].`;

function extractText(blocks: Array<{ type: string; text?: string }>): string {
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
    .trim();
}

function parseGames(text: string): ExtractedGame[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON array found in model output');
  const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Model output was not a JSON array');
  const games: ExtractedGame[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const g = item as Record<string, unknown>;
    const gameDate = typeof g.gameDate === 'string' ? g.gameDate : null;
    const opponent = typeof g.opponent === 'string' ? g.opponent.trim() : null;
    if (!gameDate || !opponent) continue;
    if (Number.isNaN(new Date(gameDate).getTime())) continue;
    games.push({ gameDate, opponent, promotions: typeof g.promotions === 'string' ? g.promotions : null });
  }
  return games;
}

// Parse a schedule the user pasted from the team's site — one fast, low-cost API call, no browsing.
export async function extractScheduleFromText(teamName: string, text: string): Promise<ExtractedGame[]> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [{ type: 'text', text: PARSE_SYSTEM, cache_control: { type: 'ephemeral' } }] as unknown as Anthropic.TextBlockParam[],
    messages: [{ role: 'user', content: `Team: ${teamName}\n\nSCHEDULE TEXT (pasted from the official site):\n${text.slice(0, 60000)}` }],
  });
  logger.debug({ teamName, tokens: resp.usage }, 'Schedule parse');
  return parseGames(extractText(resp.content as Array<{ type: string; text?: string }>));
}
