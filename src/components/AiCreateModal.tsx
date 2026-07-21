import { useEffect, useState } from 'react';
import { Cr9cd_teamsService } from '../generated/services/Cr9cd_teamsService';
import { Cr9cd_seasonsService } from '../generated/services/Cr9cd_seasonsService';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import type { Cr9cd_teams } from '../generated/models/Cr9cd_teamsModel';
import type { Cr9cd_seasons } from '../generated/models/Cr9cd_seasonsModel';
import { bindRef } from '../dataverse/bind';
import { seasonStatusChoice, gameStatusChoice, gameKindChoice, seatStatusChoice } from '../dataverse/choiceMaps';
import type { GameKind } from '../domain/enums';
import {
  planFromText,
  type AiPlan,
  type ExistingTeamRef,
  type ExistingSeasonRef,
} from '../services/aiScheduleImportService';
import { formatDateTime } from '../lib/format';
import { Modal } from './Modal';
import { Button } from './Button';
import { Badge } from './Badge';
import { TextArea } from './Field';

// date+title dedupe key, matching the game list's identity (date to day + case-insensitive title).
function itemKey(date: string | null | undefined, title: string): string {
  return `${date ? new Date(date).toDateString() : ''}|${title.trim().toLowerCase()}`;
}

function PlanChip({ label, reuse, text }: { label: string; reuse: boolean; text: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
        reuse ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-blue-200 bg-blue-50 text-blue-800'
      }`}
    >
      <span className="font-semibold">{label}:</span>
      <span>{reuse ? 'Reuse' : 'New'}</span>
      <span className="text-slate-600">{text}</span>
    </span>
  );
}

// A trigger button that opens the AI create modal. Drop it into any page's header actions.
export function AiCreateButton({
  onChanged,
  variant = 'secondary',
  size,
  label = 'Create with AI',
}: {
  onChanged?: () => void | Promise<void>;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md';
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <AiCreateModal onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}

// Natural-language creator for teams, seasons, games, and events. Self-contained: loads the current
// teams/seasons itself (so it can live on any inventory page), asks the AI Prompt flow to turn the
// request into a structured plan (reusing existing teams/seasons where they match, even when
// misspelled), previews it, then creates the records via the generated Cr9cd_* services. onChanged
// lets the host page refresh after records are created.
export function AiCreateModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void | Promise<void> }) {
  const [teams, setTeams] = useState<Cr9cd_teams[]>([]);
  const [allSeasons, setAllSeasons] = useState<Cr9cd_seasons[]>([]);
  const [loading, setLoading] = useState(true);

  const [instruction, setInstruction] = useState('');
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    teamCreated: boolean;
    hadSeason: boolean;
    seasonCreated: boolean;
    gamesCreated: number;
    skipped: number;
    seatsCreated: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      Cr9cd_teamsService.getAll({ orderBy: ['cr9cd_name asc'] }),
      Cr9cd_seasonsService.getAll({ orderBy: ['cr9cd_name asc'] }),
    ]).then(([t, s]) => {
      if (!active) return;
      setTeams(t.data ?? []);
      setAllSeasons(s.data ?? []);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const teamName = (id: string | null) => teams.find((t) => t.cr9cd_teamid === id)?.cr9cd_name ?? null;
  const seasonName = (id: string | null) => allSeasons.find((s) => s.cr9cd_seasonid === id)?.cr9cd_name ?? null;

  async function makePlan() {
    if (!instruction.trim()) return;
    setPlanning(true);
    setError('');
    setResult(null);
    setPlan(null);
    try {
      const teamRefs: ExistingTeamRef[] = teams.map((t) => ({
        id: t.cr9cd_teamid,
        name: t.cr9cd_name ?? '',
        abbreviation: t.cr9cd_abbreviation ?? null,
        defaultTicketsPerGame: t.cr9cd_default_tickets_per_game ?? null,
      }));
      const seasonRefs: ExistingSeasonRef[] = allSeasons.map((s) => ({
        id: s.cr9cd_seasonid,
        name: s.cr9cd_name ?? '',
        teamId: s._cr9cd_team_value ?? '',
      }));
      const p = await planFromText(instruction, teamRefs, seasonRefs);
      if (!p.team) throw new Error("Couldn't tell which team this is about — name the team in your request.");
      setPlan(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlanning(false);
    }
  }

  async function createAll() {
    if (!plan?.team) return;
    setCreating(true);
    setError('');
    try {
      // 1. Team — reuse or create.
      let teamId = plan.team.existingId;
      let teamDefaultTix: number;
      if (teamId) {
        teamDefaultTix = teams.find((t) => t.cr9cd_teamid === teamId)?.cr9cd_default_tickets_per_game ?? 0;
      } else {
        teamDefaultTix = plan.team.defaultTicketsPerGame ?? 0;
        const created = await Cr9cd_teamsService.create({
          cr9cd_name: plan.team.name,
          cr9cd_abbreviation: plan.team.abbreviation || undefined,
          cr9cd_default_tickets_per_game: teamDefaultTix,
        } as Parameters<typeof Cr9cd_teamsService.create>[0]);
        teamId = created.data?.cr9cd_teamid ?? null;
        if (!teamId) throw new Error('Failed to create the team');
      }

      // 2. Season — reuse or create (only when a season/games were requested).
      let seasonId: string | null = null;
      if (plan.season) {
        seasonId = plan.season.existingId;
        if (!seasonId) {
          const created = await Cr9cd_seasonsService.create({
            cr9cd_name: plan.season.name,
            'cr9cd_Team@odata.bind': bindRef('cr9cd_teams', teamId),
            cr9cd_status: seasonStatusChoice.toCode('active'),
          } as Parameters<typeof Cr9cd_seasonsService.create>[0]);
          seasonId = created.data?.cr9cd_seasonid ?? null;
          if (!seasonId) throw new Error('Failed to create the season');
        }
      }

      // 3. Games/Events + seats — dedupe against what's already in the season by date+title.
      let gamesCreated = 0;
      let skipped = 0;
      let seatsCreated = 0;
      if (seasonId && plan.items.length) {
        const existing = await Cr9cd_gamesService.getAll({ filter: `_cr9cd_season_value eq ${seasonId}` });
        const existingKeys = new Set(
          (existing.data ?? []).map((g) => {
            const kind: GameKind = g.cr9cd_kind != null ? gameKindChoice.toValue(g.cr9cd_kind) : 'game';
            const title = kind === 'event' ? g.cr9cd_title : g.cr9cd_opponent;
            return itemKey(g.cr9cd_game_date, title ?? '');
          })
        );
        for (const item of plan.items) {
          if (existingKeys.has(itemKey(item.date, item.title))) {
            skipped++;
            continue;
          }
          const seatCount = item.seats ?? teamDefaultTix;
          const created = await Cr9cd_gamesService.create({
            cr9cd_game_date: new Date(item.date).toISOString(),
            cr9cd_opponent: item.kind === 'game' ? item.title : '',
            cr9cd_title: item.kind === 'event' ? item.title : '',
            'cr9cd_Season@odata.bind': bindRef('cr9cd_seasons', seasonId),
            cr9cd_status: gameStatusChoice.toCode('scheduled'),
            cr9cd_kind: gameKindChoice.toCode(item.kind),
            cr9cd_total_seats: seatCount,
          } as Parameters<typeof Cr9cd_gamesService.create>[0]);
          gamesCreated++;
          const gameId = created.data?.cr9cd_gameid;
          if (gameId && seatCount > 0) {
            for (let s = 1; s <= seatCount; s++) {
              await Cr9cd_seatsService.create({
                'cr9cd_Game@odata.bind': bindRef('cr9cd_games', gameId),
                cr9cd_section: 'GA',
                cr9cd_row: '1',
                cr9cd_seat_number: String(s),
                cr9cd_status: seatStatusChoice.toCode('available'),
              } as Parameters<typeof Cr9cd_seatsService.create>[0]);
              seatsCreated++;
            }
          }
        }
      }

      setResult({
        teamCreated: !plan.team.existingId,
        hadSeason: !!plan.season,
        seasonCreated: plan.season ? !plan.season.existingId : false,
        gamesCreated,
        skipped,
        seatsCreated,
      });
      setPlan(null);
      setInstruction('');
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Create with AI"
      description="Describe a team, season, or schedule in plain language — the AI reuses existing teams/seasons where they match and creates the rest."
      size="lg"
      footer={
        result ? (
          <Button onClick={onClose}>Close</Button>
        ) : plan ? (
          <>
            <Button variant="secondary" disabled={creating} onClick={() => setPlan(null)}>
              Discard
            </Button>
            <Button loading={creating} onClick={createAll}>
              Create all
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={planning} disabled={!instruction.trim() || loading} onClick={makePlan}>
              Plan with AI
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <TextArea
          rows={4}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={'e.g. "Add the Vegas Golden Knights (VGK, 10 tickets) with a 2026-27 season and their home schedule: Wed Oct 7 7:30 PM vs Anaheim Ducks (Home Opener) …"'}
        />
        {loading && <p className="text-xs text-slate-400">Loading current teams &amp; seasons…</p>}

        {plan && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap gap-2">
              <PlanChip
                label="Team"
                reuse={!!plan.team?.existingId}
                text={
                  plan.team?.existingId
                    ? teamName(plan.team.existingId) ?? plan.team.name
                    : `${plan.team?.name}${plan.team?.abbreviation ? ` (${plan.team.abbreviation})` : ''} · ${plan.team?.defaultTicketsPerGame ?? 0} tix`
                }
              />
              {plan.season && (
                <PlanChip
                  label="Season"
                  reuse={!!plan.season.existingId}
                  text={plan.season.existingId ? seasonName(plan.season.existingId) ?? plan.season.name : plan.season.name}
                />
              )}
            </div>

            {plan.items.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {plan.items.length} game/event{plan.items.length === 1 ? '' : 's'} · duplicates in an existing season are skipped
                </div>
                <div className="max-h-64 overflow-auto rounded-md border border-slate-100">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-100">
                      {plan.items.map((it, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1.5 text-slate-500">{formatDateTime(it.date)}</td>
                          <td className="px-3 py-1.5">
                            <Badge tone="slate">{it.kind}</Badge>
                          </td>
                          <td className="px-3 py-1.5 font-medium text-slate-800">{it.kind === 'game' ? `vs ${it.title}` : it.title}</td>
                          <td className="px-3 py-1.5 text-xs text-slate-400">{it.promotions ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {plan.notes && <p className="text-xs text-slate-500">Note: {plan.notes}</p>}
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {`Done — ${result.teamCreated ? 'created team' : 'reused team'}`}
            {result.hadSeason ? (result.seasonCreated ? ', created season' : ', reused season') : ''}
            {result.gamesCreated || result.skipped
              ? `, added ${result.gamesCreated} game(s)/event(s)${result.skipped ? ` (${result.skipped} skipped as duplicates)` : ''}, ${result.seatsCreated} seats`
              : ''}
            .
          </div>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}
