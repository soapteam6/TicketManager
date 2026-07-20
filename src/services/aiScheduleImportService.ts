import { MicrosoftDataverseService } from '../generated/services/MicrosoftDataverseService';

export interface ExtractedGame {
  gameDate: string;
  opponent: string;
  promotions: string | null;
}

// The "AI Prompt" action lives in the Dynamics Test environment, NOT the environment this Code App is
// published in. Native flow binding only reaches the published env, so this goes through the Microsoft
// Dataverse connector's cross-org "Perform an unbound action in selected environment"
// (PerformUnboundActionWithOrganization) against an explicit target org URL -- the same cross-org
// pattern crmService.ts uses for the CRM reads. "AI Prompt" takes `system` + `user` (+ optional `image`)
// pass-through inputs and returns the model text in `response`.
const DYNAMICS_TEST_ORG = 'https://orgfca328be.crm.dynamics.com';

// The action's operation name as the connector invokes it in Dynamics Test. "AI Prompt" is the display
// label; a Dataverse action's callable unique name can't contain spaces, so if the call 404s this is the
// one string to correct (e.g. the Custom API unique name shown on the action's definition).
const AI_PROMPT_ACTION = 'AI Prompt';

// Ported verbatim from the original app's PARSE_SYSTEM prompt (packages/server/src/adapters/schedule/importer.ts)
// -- the rules/output-contract are provider-agnostic. It's passed as the action's `system` input; the pasted
// schedule goes in as `user`, mirroring the original direct Anthropic call's system/user split.
const PARSE_SYSTEM = `You turn a pasted sports schedule (copied from a team's official site) into structured JSON.
RULES:
- HOME games only. Exclude away games and past games; include the full home slate present in the text.
- Each home game: date + local START TIME as ISO 8601 (e.g. "2026-10-14T19:00:00"); if the start time
  isn't shown, use the date with "T00:00:00". Also the opponent, and any promotion/theme note if present.
- Use the times as written; do not convert time zones. Infer the year from context if it isn't on each line.
OUTPUT: ONLY a JSON array (no prose, no code fences): {"gameDate":"<ISO>","opponent":"<string>","promotions":"<string or null>"}.
If there is no home schedule in the text, respond with exactly [].`;

// Same fenced-code-block-stripping + tolerant-array-extraction logic as the original parseGames() --
// prompt responses aren't guaranteed to skip markdown fences even when asked to.
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

// Parse a schedule the user pasted from the team's site via the "AI Prompt" action in Dynamics Test --
// one action call, no browsing. Throws on any failure; callers keep the existing degrade-gracefully
// contract (schedule import via the .xlsx template still works without this).
export async function extractScheduleFromText(teamName: string, rawText: string): Promise<ExtractedGame[]> {
  const user = `Team: ${teamName}\n\nSCHEDULE TEXT (pasted from the official site):\n${rawText.slice(0, 60000)}`;
  const result = await MicrosoftDataverseService.PerformUnboundActionWithOrganization(DYNAMICS_TEST_ORG, AI_PROMPT_ACTION, {
    system: PARSE_SYSTEM,
    user,
  });
  if (!result.data) throw new Error('The AI Prompt action returned no response');
  const response = (result.data as { response?: unknown }).response;
  const raw = typeof response === 'string' ? response : '';
  if (!raw.trim()) throw new Error('The AI Prompt action returned an empty response');
  return parseGames(raw);
}
