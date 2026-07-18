import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { REQUEST_STATUS } from '@ais/shared';
import { api } from '@/lib/api';
import type { DashboardOverview, RemainingSeatsRow } from '@/lib/types';
import { pickArray } from '@/lib/unwrap';
import { formatNumber, formatDate, titleCase } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { QueryState } from '@/components/QueryState';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';

function IconStack() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7l8-4 8 4-8 4-8-4zm0 5l8 4 8-4M4 17l8 4 8-4" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3M3 11h18M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}
function IconSeat() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 18v-2a4 4 0 014-4h8a4 4 0 014 4v2M6 12V6a2 2 0 012-2h8a2 2 0 012 2v6" />
    </svg>
  );
}
function IconMoney() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V6m0 10v2m0-2c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export function DashboardPage() {
  const overview = useQuery({
    queryKey: ['dashboards', 'overview'],
    queryFn: async () => (await api.get<DashboardOverview>('/dashboards/overview')).data,
  });

  const remaining = useQuery({
    queryKey: ['dashboards', 'remaining-seats'],
    queryFn: async () => {
      const res = await api.get('/dashboards/remaining-seats');
      return pickArray<RemainingSeatsRow>(res.data, 'games');
    },
  });

  const o = overview.data;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Season-wide inventory, distribution, and ROI at a glance." />

      <QueryState isLoading={overview.isLoading} error={overview.error}>
        {o && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Teams" value={formatNumber(o.teams)} icon={<IconStack />} tone="brand" hint={`${formatNumber(o.activeSeasons)} active season(s)`} />
            <StatCard label="Upcoming games" value={formatNumber(o.upcomingGames)} icon={<IconCalendar />} tone="violet" />
            <StatCard
              label="Seat utilization"
              value={`${formatNumber(o.assignedSeats)} / ${formatNumber(o.totalSeats)}`}
              hint={`${formatNumber(o.transferredSeats)} transferred`}
              icon={<IconSeat />}
              tone="emerald"
            />
            <StatCard
              label="Open requests"
              value={formatNumber(
                (o.requestsByStatus?.submitted ?? 0) +
                  (o.requestsByStatus?.scored ?? 0) +
                  (o.requestsByStatus?.recommended ?? 0)
              )}
              hint="submitted · scored · recommended"
              icon={<IconMoney />}
              tone="amber"
            />
          </div>
        )}
      </QueryState>

      {/* Requests by status */}
      {o && (
        <div className="mt-6 card p-5">
          <h3 className="text-sm font-semibold text-slate-800">Requests by status</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {REQUEST_STATUS.map((s) => {
              const count = o.requestsByStatus?.[s] ?? 0;
              if (!count) return null;
              return (
                <Badge key={s} status={s}>
                  {titleCase(s)} · {count}
                </Badge>
              );
            })}
            {Object.values(o.requestsByStatus ?? {}).every((v) => !v) && (
              <span className="text-sm text-slate-400">No requests yet.</span>
            )}
          </div>
        </div>
      )}

      {/* Upcoming games — a clean, scannable list with seat availability */}
      <div className="mt-6 card p-5">
        <h3 className="text-sm font-semibold text-slate-800">Upcoming games</h3>
        <QueryState isLoading={remaining.isLoading} error={remaining.error}>
          {remaining.data && remaining.data.length > 0 ? (
            <div className="mt-2 divide-y divide-slate-100">
              {remaining.data.slice(0, 8).map((g) => {
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
                        {g.teamName} <span className="text-slate-400">vs</span> {g.opponent}
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
            <div className="mt-4">
              <EmptyState title="No upcoming games" description="Add games with seats to see availability." />
            </div>
          )}
        </QueryState>
      </div>
    </div>
  );
}
