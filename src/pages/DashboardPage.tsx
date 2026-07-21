import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cr9cd_teamsService } from '../generated/services/Cr9cd_teamsService';
import { Cr9cd_seasonsService } from '../generated/services/Cr9cd_seasonsService';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import { Cr9cd_ticketrequestsService } from '../generated/services/Cr9cd_ticketrequestsService';
import { seasonStatusChoice, gameStatusChoice, seatStatusChoice, requestStatusChoice, gameKindChoice } from '../dataverse/choiceMaps';
import { REQUEST_STATUS } from '../domain/enums';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { formatDate, titleCase } from '../lib/format';

interface UpcomingGame {
  gameId: string;
  gameDate: string | undefined;
  label: string;
  opponent: string | null;
  remaining: number;
  totalSeats: number;
}

export default function DashboardPage() {
  const [teamCount, setTeamCount] = useState(0);
  const [activeSeasons, setActiveSeasons] = useState(0);
  const [upcomingGames, setUpcomingGames] = useState(0);
  const [seatUtilization, setSeatUtilization] = useState<{ total: number; used: number }>({ total: 0, used: 0 });
  const [requestsByStatus, setRequestsByStatus] = useState<Record<string, number>>({});
  const [upcomingList, setUpcomingList] = useState<UpcomingGame[]>([]);

  useEffect(() => {
    (async () => {
      const [teamsResult, seasonsResult, gamesResult, seatsResult, requestsResult] = await Promise.all([
        Cr9cd_teamsService.getAll({ select: ['cr9cd_teamid'] }),
        Cr9cd_seasonsService.getAll({ filter: `cr9cd_status eq ${seasonStatusChoice.toCode('active')}`, select: ['cr9cd_seasonid'] }),
        Cr9cd_gamesService.getAll({
          filter: `cr9cd_status eq ${gameStatusChoice.toCode('scheduled')} and cr9cd_game_date ge ${new Date().toISOString()}`,
          orderBy: ['cr9cd_game_date asc'],
        }),
        Cr9cd_seatsService.getAll({ select: ['cr9cd_status', '_cr9cd_game_value'] }),
        Cr9cd_ticketrequestsService.getAll({ select: ['cr9cd_status'] }),
      ]);

      const upcoming = gamesResult.data ?? [];
      setTeamCount(teamsResult.data?.length ?? 0);
      setActiveSeasons(seasonsResult.data?.length ?? 0);
      setUpcomingGames(upcoming.length);

      // Team names for the game labels — pull the seasons referenced by upcoming games.
      const seasonIds = [...new Set(upcoming.map((g) => g._cr9cd_season_value).filter((v): v is string => Boolean(v)))];
      const teamBySeason = new Map<string, string>();
      if (seasonIds.length > 0) {
        const seasonsFilter = seasonIds.map((id) => `cr9cd_seasonid eq ${id}`).join(' or ');
        // cr9cd_teamname is a phantom $select column (400s -> silent []); join to teams via _cr9cd_team_value.
        const [seasonsForGames, teamsResult] = await Promise.all([
          Cr9cd_seasonsService.getAll({ filter: seasonsFilter, select: ['cr9cd_seasonid', '_cr9cd_team_value'] }),
          Cr9cd_teamsService.getAll({ select: ['cr9cd_teamid', 'cr9cd_name'] }),
        ]);
        const teamNameById = new Map((teamsResult.data ?? []).map((t) => [t.cr9cd_teamid, t.cr9cd_name ?? '']));
        for (const s of seasonsForGames.data ?? [])
          teamBySeason.set(s.cr9cd_seasonid, (s._cr9cd_team_value ? teamNameById.get(s._cr9cd_team_value) : '') ?? '');
      }

      // Group seats by game to derive per-game total + available, and overall utilization.
      const seats = seatsResult.data ?? [];
      const perGame = new Map<string, { total: number; available: number }>();
      let used = 0;
      for (const s of seats) {
        const status = s.cr9cd_status != null ? seatStatusChoice.toValue(s.cr9cd_status) : 'available';
        if (status === 'assigned' || status === 'transferred') used += 1;
        const gid = s._cr9cd_game_value;
        if (!gid) continue;
        const bucket = perGame.get(gid) ?? { total: 0, available: 0 };
        bucket.total += 1;
        if (status === 'available') bucket.available += 1;
        perGame.set(gid, bucket);
      }
      setSeatUtilization({ total: seats.length, used });

      setUpcomingList(
        upcoming.slice(0, 8).map((g) => {
          const bucket = perGame.get(g.cr9cd_gameid) ?? { total: 0, available: 0 };
          const kind = g.cr9cd_kind != null ? gameKindChoice.toValue(g.cr9cd_kind) : 'game';
          const team = g._cr9cd_season_value ? teamBySeason.get(g._cr9cd_season_value) ?? '' : '';
          const label = kind === 'event' ? g.cr9cd_title ?? 'Event' : team || 'Game';
          return {
            gameId: g.cr9cd_gameid,
            gameDate: g.cr9cd_game_date,
            label,
            opponent: kind === 'event' ? null : g.cr9cd_opponent ?? null,
            remaining: bucket.available,
            totalSeats: bucket.total,
          };
        })
      );

      const counts: Record<string, number> = {};
      for (const status of REQUEST_STATUS) counts[status] = 0;
      for (const r of requestsResult.data ?? []) {
        const status = r.cr9cd_status != null ? requestStatusChoice.toValue(r.cr9cd_status) : 'submitted';
        counts[status] = (counts[status] ?? 0) + 1;
      }
      setRequestsByStatus(counts);
    })();
  }, []);

  const openRequests =
    (requestsByStatus['submitted'] ?? 0) + (requestsByStatus['scored'] ?? 0) + (requestsByStatus['recommended'] ?? 0);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Season-wide inventory, distribution, and ROI at a glance." />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Teams" value={teamCount} hint={`${activeSeasons} active season(s)`} tone="brand" />
        <StatCard label="Upcoming games" value={upcomingGames} tone="amber" />
        <StatCard
          label="Seat utilization"
          value={`${seatUtilization.used} / ${seatUtilization.total}`}
          hint="0 transferred"
          tone="emerald"
        />
        <StatCard
          label="Open requests"
          value={openRequests}
          hint="submitted · scored · recommended"
          tone="brand"
        />
      </div>

      <div className="card mb-6 p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Requests by status</h2>
        <div className="flex flex-wrap gap-4">
          {REQUEST_STATUS.map((status) => (
            <Badge key={status} status={status}>
              {titleCase(status)} · {requestsByStatus[status] ?? 0}
            </Badge>
          ))}
        </div>
      </div>

      {/* Upcoming games — a clean, scannable list with seat availability */}
      <div className="card p-5">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Upcoming games</h2>
        {upcomingList.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {upcomingList.map((g) => {
              const pct = g.totalSeats > 0 ? (g.remaining / g.totalSeats) * 100 : 0;
              return (
                <Link
                  key={g.gameId}
                  to={`/games/${g.gameId}`}
                  className="-mx-2 flex items-center gap-4 rounded-md px-2 py-3 transition hover:bg-slate-50"
                >
                  <div className="w-24 shrink-0 text-sm text-slate-500">{formatDate(g.gameDate)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">
                      {g.label}
                      {g.opponent && (
                        <>
                          {' '}
                          <span className="text-slate-400">vs</span> {g.opponent}
                        </>
                      )}
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="w-28 shrink-0 text-right text-sm">
                    <span className="font-semibold text-slate-800">{g.remaining}</span>
                    <span className="text-slate-400"> / {g.totalSeats} open</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="mt-2">
            <EmptyState title="No upcoming games" description="Add games with seats to see availability." />
          </div>
        )}
      </div>
    </div>
  );
}
