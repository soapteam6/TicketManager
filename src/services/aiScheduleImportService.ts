import { PowerAppV2__Runaprompt_ParseJSON_RespondtoaPowerApporflowService } from '../generated/services/PowerAppV2__Runaprompt_ParseJSON_RespondtoaPowerApporflowService';

export interface ExtractedGame {
  gameDate: string;
  opponent: string;
  promotions: string | null;
}

// Ported verbatim from the original app's PARSE_SYSTEM prompt (packages/server/src/adapters/schedule/importer.ts)
// -- the rules/output-contract are provider-agnostic, only the transport changed (direct Anthropic call ->
// this environment's "PowerAppV2 -> Run a prompt" cloud flow, an AI Builder prompt with a single free-text input).
const PARSE_SYSTEM = `You turn a pasted sports schedule (copied from a team's official site) into structured JSON.
RULES:
- HOME games only. Exclude away games and past games; include the full home slate present in the text.
- Each home game: date + local START TIME as ISO 8601 (e.g. "2026-10-14T19:00:00"); if the start time
  isn't shown, use the date with "T00:00:00". Also the opponent, and any promotion/theme note if present.
- Use the times as written; do not convert time zones. Infer the year from context if it isn't on each line.
OUTPUT: ONLY a JSON array (no prose, no code fences): {"gameDate":"<ISO>","opponent":"<string>","promotions":"<string or null>"}.
If there is no home schedule in the text, respond with exactly [].`;

// Same fenced-code-block-stripping + tolerant-array-extraction logic as the original parseGames() --
// AI Builder prompt responses aren't guaranteed to skip markdown fences even when asked to.
function parseGames(text: string): ExtractedGame[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON array found in the AI response');
  const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) throw new Error('AI response was not a JSON array');
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

// The flow's "Respond to a Power App or flow" action exposes several differently-named output
// fields depending on how its AI Builder prompt step was configured -- try them in a sensible
// order rather than guessing one.
function extractResponseText(output: {
  result?: string;
  promptresponse?: string;
  predicitonoutput?: string;
  json_body?: string;
  json_deliverable?: string;
}): string {
  return output.result || output.promptresponse || output.json_deliverable || output.json_body || output.predicitonoutput || '';
}

// Parse a schedule the user pasted from the team's site via this environment's AI Prompt cloud
// flow -- one flow call, no browsing. Throws on any failure; callers keep the existing
// degrade-gracefully contract (schedule import via the .xlsx template still works without this).
export async function extractScheduleFromText(teamName: string, rawText: string): Promise<ExtractedGame[]> {
  const prompt = `${PARSE_SYSTEM}\n\nTeam: ${teamName}\n\nSCHEDULE TEXT (pasted from the official site):\n${rawText.slice(0, 60000)}`;
  const result = await PowerAppV2__Runaprompt_ParseJSON_RespondtoaPowerApporflowService.Run({ text: prompt });
  if (!result.data) throw new Error('The AI flow returned no response');
  const raw = extractResponseText(result.data);
  if (!raw.trim()) throw new Error('The AI flow returned an empty response');
  return parseGames(raw);
}
