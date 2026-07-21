import { MicrosoftDataverseService } from '../generated/services/MicrosoftDataverseService';

// AI-assisted setup planner. The user describes what they want in natural language; an AI Builder prompt
// in Dynamics Test (invoked cross-org via the Dataverse `Predict` bound action — see runAiPrompt below)
// turns it into a structured plan of a team + season + games/events. The app then creates the records
// via the generated Cr9cd_* services. The prompt is text-in/text-out only, so all record creation and
// fuzzy-match resolution happens app-side around it.
//
// Intelligence requirement: the caller passes the EXISTING teams/seasons in, and the model reuses one
// (by id) when the request plainly refers to it -- even with a misspelling, different casing, an
// abbreviation, or extra/removed words -- rather than creating a duplicate. Only genuinely-new things
// get existingId=null.

export type AiItemKind = 'game' | 'event';

// A single game or event to create under the resolved season.
export interface AiPlanItem {
  kind: AiItemKind;
  date: string; // ISO 8601 (local start time; "…T00:00:00" when no time was given)
  title: string; // opponent (game) or event name (event)
  promotions: string | null;
  seats: number | null; // explicit per-item seat count, else null → fall back to the team default
}

export interface AiPlanTeam {
  existingId: string | null; // reuse this team when set; create new when null
  name: string;
  abbreviation: string | null;
  defaultTicketsPerGame: number | null;
}

export interface AiPlanSeason {
  existingId: string | null; // reuse this season when set; create new when null
  name: string;
}

export interface AiPlan {
  team: AiPlanTeam | null; // null when the request names no resolvable team
  season: AiPlanSeason | null; // null when no season/games were requested
  items: AiPlanItem[];
  notes: string | null; // optional model note (ambiguity, assumptions) surfaced to the user
}

// Lightweight views of existing records handed to the model so it can match against them.
export interface ExistingTeamRef {
  id: string;
  name: string;
  abbreviation: string | null;
  defaultTicketsPerGame: number | null;
}
export interface ExistingSeasonRef {
  id: string;
  name: string;
  teamId: string;
}

const PLAN_SYSTEM = `You turn a user's natural-language request into a structured plan for a sports ticket app; the app then creates the records. The app has Teams, Seasons (each belongs to a team), and Games/Events (each belongs to a season). A "game" has an opponent; an "event" is a non-game item with a title.
You are given the EXISTING teams and seasons as JSON.
MATCHING RULE (important): if the user refers to a team or season that already exists — even with a misspelling, different casing, an abbreviation, or extra/removed words — REUSE it by setting its "existingId" to that record's id. Only set existingId to null (create new) when nothing existing reasonably matches.
- Resolve exactly one target team. If games/events are requested, also resolve one season UNDER that team; a season's existingId must be one whose teamId equals the resolved team's id.
- For each game/event: "date" is the local START TIME as ISO 8601 (e.g. "2026-10-14T19:00:00"); if no start time is given use the date with "T00:00:00". Use times as written; do not convert time zones. Infer the year from context. "kind" is "game" (set title = the opponent) or "event" (set title = the event name). Include a promotion/theme note if present, else null. "seats" is an integer only if the user gives a per-item ticket count, else null.
OUTPUT: ONLY a single JSON object (no prose, no code fences):
{"team":{"existingId":<string|null>,"name":<string>,"abbreviation":<string|null>,"defaultTicketsPerGame":<int|null>}|null,"season":{"existingId":<string|null>,"name":<string>}|null,"items":[{"kind":"game"|"event","date":<ISO>,"title":<string>,"promotions":<string|null>,"seats":<int|null>}],"notes":<string|null>}
If no team can be determined, set "team" to null. If no season/games are requested, set "season" to null and "items" to [].`;

// Tolerant single-object extraction — model responses may wrap JSON in markdown fences even when asked not to.
function parsePlan(text: string): AiPlan {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object found in the AI response');
  const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;

  const rawTeam = parsed.team as Record<string, unknown> | null | undefined;
  const team: AiPlanTeam | null =
    rawTeam && typeof rawTeam === 'object'
      ? {
          existingId: typeof rawTeam.existingId === 'string' ? rawTeam.existingId : null,
          name: typeof rawTeam.name === 'string' ? rawTeam.name.trim() : '',
          abbreviation: typeof rawTeam.abbreviation === 'string' ? rawTeam.abbreviation.trim() : null,
          defaultTicketsPerGame:
            typeof rawTeam.defaultTicketsPerGame === 'number' ? rawTeam.defaultTicketsPerGame : null,
        }
      : null;

  const rawSeason = parsed.season as Record<string, unknown> | null | undefined;
  const season: AiPlanSeason | null =
    rawSeason && typeof rawSeason === 'object'
      ? {
          existingId: typeof rawSeason.existingId === 'string' ? rawSeason.existingId : null,
          name: typeof rawSeason.name === 'string' ? rawSeason.name.trim() : '',
        }
      : null;

  const items: AiPlanItem[] = [];
  if (Array.isArray(parsed.items)) {
    for (const raw of parsed.items) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const date = typeof r.date === 'string' ? r.date : null;
      const title = typeof r.title === 'string' ? r.title.trim() : null;
      if (!date || !title) continue;
      if (Number.isNaN(new Date(date).getTime())) continue;
      items.push({
        kind: r.kind === 'event' ? 'event' : 'game',
        date,
        title,
        promotions: typeof r.promotions === 'string' ? r.promotions : null,
        seats: typeof r.seats === 'number' ? r.seats : null,
      });
    }
  }

  return { team, season, items, notes: typeof parsed.notes === 'string' ? parsed.notes : null };
}

// The parsing model is an AI Builder custom GPT prompt (msdyn_aimodel) that lives in the Dynamics Test
// environment (`orgfca328be`), a different env than the one this Code App is published in. It's invoked
// through the Dataverse `Predict` bound action. Native binding only reaches the published env, so this
// goes through the Microsoft Dataverse connector's cross-org "Perform a bound action in selected
// environment" (PerformBoundActionWithOrganization) with an explicit target org URL -- the same
// cross-org pattern crmService.ts uses for the CRM reads. Predict takes `version` + `requestv2`
// (system/user, expando) + `source` (REQUIRED -- omitting it fails with "Source is null") and returns
// the model text at responsev2.predictionOutput.text. Validated live against this model before wiring.
// (Earlier attempts via a Logic-flows connector could not work: that connector only resolves flows in
// the app's OWN env, and this prompt/flow lives in Dynamics Test.)
const DYNAMICS_TEST_ORG = 'https://orgfca328be.crm.dynamics.com';

// The text-only AI Builder custom prompt's record id (msdyn_aimodel) in Dynamics Test. There is also an
// image-capable variant (5d66f258-8d25-4d7d-8bbc-8a33c44fb3d0); this feature is text-only.
const AI_PROMPT_MODEL_ID = '6f1f4334-4e08-4eeb-bdb5-a3836ae08959';

// Run the Dynamics Test AI Builder prompt with a system+user split; returns the raw model text.
async function runAiPrompt(system: string, user: string): Promise<string> {
  const result = await MicrosoftDataverseService.PerformBoundActionWithOrganization(
    DYNAMICS_TEST_ORG,
    'msdyn_aimodels',
    // Must be the FULLY-QUALIFIED action name: the connector substitutes this straight into the Web API
    // path (.../{entityName}({recordId})/{actionName}), and Dataverse 404s on a bare "Predict".
    'Microsoft.Dynamics.CRM.Predict',
    AI_PROMPT_MODEL_ID,
    {
      version: '2.0',
      requestv2: { '@odata.type': 'Microsoft.Dynamics.CRM.expando', system, user },
      source: JSON.stringify({ consumptionSource: 'PowerApps', partnerSource: 'AIBuilder' }),
    }
  );
  const data = result.data as { responsev2?: { predictionOutput?: { text?: unknown } } } | undefined;
  if (!data) throw new Error('The AI prompt returned no response');
  const text = data.responsev2?.predictionOutput?.text;
  const raw = typeof text === 'string' ? text : '';
  if (!raw.trim()) throw new Error('The AI prompt returned an empty response');
  return raw;
}

// Ask the AI to turn a free-text request into a create-plan, given the current teams/seasons for matching.
// Throws on any failure; callers keep the manual create modals as the fallback path.
export async function planFromText(
  instruction: string,
  existingTeams: ExistingTeamRef[],
  existingSeasons: ExistingSeasonRef[]
): Promise<AiPlan> {
  const user = [
    'REQUEST:',
    instruction.slice(0, 60000),
    '',
    `EXISTING TEAMS (JSON): ${JSON.stringify(existingTeams)}`,
    `EXISTING SEASONS (JSON): ${JSON.stringify(existingSeasons)}`,
  ].join('\n');

  const raw = await runAiPrompt(PLAN_SYSTEM, user);
  return parsePlan(raw);
}
