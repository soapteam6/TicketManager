import { useEffect, useState } from 'react';
import { Cr9cd_teamsService } from '../generated/services/Cr9cd_teamsService';
import { Cr9cd_seasonsService } from '../generated/services/Cr9cd_seasonsService';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import { Cr9cd_seatsService } from '../generated/services/Cr9cd_seatsService';
import { Cr9cd_ticketrequestsService } from '../generated/services/Cr9cd_ticketrequestsService';
import { seasonStatusChoice, gameStatusChoice, seatStatusChoice, requestStatusChoice } from '../dataverse/choiceMaps';
import { REQUEST_STATUS } from '../domain/enums';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/Badge';

export default function DashboardPage() {
  const [teamCount, setTeamCount] = useState(0);
  const [activeSeasons, setActiveSeasons] = useState(0);
  const [upcomingGames, setUpcomingGames] = useState(0);
  const [seatUtilization, setSeatUtilization] = useState<{ total: number; used: number }>({ total: 0, used: 0 });
  const [requestsByStatus, setRequestsByStatus] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const [teamsResult, seasonsResult, gamesResult, seatsResult, requestsResult] = await Promise.all([
        Cr9cd_teamsService.getAll({ select: ['cr9cd_teamid'] }),
        Cr9cd_seasonsService.getAll({ filter: `cr9cd_status eq ${seasonStatusChoice.toCode('active')}`, select: ['cr9cd_seasonid'] }),
        Cr9cd_gamesService.getAll({
          filter: `cr9cd_status eq ${gameStatusChoice.toCode('scheduled')} and cr9cd_game_date ge ${new Date().toISOString()}`,
          select: ['cr9cd_gameid'],
        }),
        Cr9cd_seatsService.getAll({ select: ['cr9cd_status'] }),
        Cr9cd_ticketrequestsService.getAll({ select: ['cr9cd_status'] }),
      ]);

      setTeamCount(teamsResult.data?.length ?? 0);
      setActiveSeasons(seasonsResult.data?.length ?? 0);
      setUpcomingGames(gamesResult.data?.length ?? 0);

      const seats = seatsResult.data ?? [];
      const used = seats.filter((s) => {
        const status = s.cr9cd_status != null ? seatStatusChoice.toValue(s.cr9cd_status) : 'available';
        return status === 'assigned' || status === 'transferred';
      }).length;
      setSeatUtilization({ total: seats.length, used });

      const counts: Record<string, number> = {};
      for (const status of REQUEST_STATUS) counts[status] = 0;
      for (const r of requestsResult.data ?? []) {
        const status = r.cr9cd_status != null ? requestStatusChoice.toValue(r.cr9cd_status) : 'submitted';
        counts[status] = (counts[status] ?? 0) + 1;
      }
      setRequestsByStatus(counts);
    })();
  }, []);

  const utilizationPct = seatUtilization.total > 0 ? Math.round((100 * seatUtilization.used) / seatUtilization.total) : 0;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Season ticket utilization across all teams" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Teams" value={teamCount} tone="brand" />
        <StatCard label="Active seasons" value={activeSeasons} tone="violet" />
        <StatCard label="Upcoming games" value={upcomingGames} tone="amber" />
        <StatCard
          label="Seat utilization"
          value={`${utilizationPct}%`}
          hint={`${seatUtilization.used} of ${seatUtilization.total} seats`}
          tone="emerald"
        />
      </div>

      <div className="card p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Requests by status</h2>
        <div className="flex flex-wrap gap-4">
          {REQUEST_STATUS.map((status) => (
            <div key={status} className="flex items-center gap-2">
              <Badge status={status} />
              <span className="text-sm font-semibold tabular-nums text-slate-700">{requestsByStatus[status] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
