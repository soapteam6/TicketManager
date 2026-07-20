import { useEffect, useState, useCallback } from 'react';
import { Cr9cd_scoringconfigsService } from '../generated/services/Cr9cd_scoringconfigsService';
import type { Cr9cd_scoringconfigs } from '../generated/models/Cr9cd_scoringconfigsModel';
import { getActiveScoringConfig, createScoringConfig, activateScoringConfig, deleteScoringConfig, readScoringConfigRow } from '../services/scoringService';
import { FACTOR_KEYS } from '../domain/enums';
import { FACTOR_LABELS, DEFAULT_SCORING_WEIGHTS, DEFAULT_SCORING_PARAMS } from '../domain/constants';
import type { FactorKey } from '../domain/enums';
import type { ScoringParams } from '../domain/constants';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { DataTable, type Column } from '../components/DataTable';

export default function ScoringConfigPage() {
  const [activeVersion, setActiveVersion] = useState<number | null>(null);
  const [history, setHistory] = useState<Cr9cd_scoringconfigs[]>([]);
  const [weights, setWeights] = useState<Record<FactorKey, number>>({ ...DEFAULT_SCORING_WEIGHTS });
  const [params, setParams] = useState<ScoringParams>({ ...DEFAULT_SCORING_PARAMS });
  const [busy, setBusy] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const active = await getActiveScoringConfig();
    setActiveVersion(active.version || null);
    setWeights(active.weights);
    setParams(active.params);
    setLoadedId(active.id || null);
    const historyResult = await Cr9cd_scoringconfigsService.getAll({ orderBy: ['cr9cd_version desc'] });
    setHistory(historyResult.data ?? []);
  }, []);

  // Load an archived/saved config's weights & parameters into the editor above.
  function loadConfig(row: Cr9cd_scoringconfigs) {
    const { weights: w, params: p } = readScoringConfigRow(row);
    setWeights(w);
    setParams(p);
    setLoadedId(row.cr9cd_scoringconfigid);
  }

  useEffect(() => {
    load();
  }, [load]);

  const totalWeight = FACTOR_KEYS.reduce((s, key) => s + (weights[key] ?? 0), 0);
  const totalOk = Math.abs(totalWeight - 1) < 0.01;

  async function saveAndActivate() {
    setBusy(true);
    try {
      await createScoringConfig(weights, params, true);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const paramFields: Array<{ key: keyof ScoringParams; label: string; step?: number; min?: number; max?: number }> = [
    { key: 'salesOppCapUsd', label: 'Sales opportunity cap ($)' },
    { key: 'fairnessHalfLifeDays', label: 'Fairness half-life (days)' },
    { key: 'leadTimeSweetSpotDays', label: 'Lead-time sweet spot (days)' },
    { key: 'leadTimeWindowDays', label: 'Lead-time window (days)' },
    { key: 'targetEmployeeShare', label: 'Target employee share (0-1)', step: 0.05, min: 0, max: 1 },
  ];

  const columns: Column<Cr9cd_scoringconfigs>[] = [
    {
      key: 'version',
      header: 'Version',
      render: (h) => (
        <div className="flex flex-col gap-1">
          <span className="inline-flex items-center gap-2">
            <span className="font-semibold text-slate-900">{h.cr9cd_name || `v${h.cr9cd_version}`}</span>
            {loadedId === h.cr9cd_scoringconfigid && <Badge tone="blue">Editing</Badge>}
          </span>
          <span className="text-xs text-slate-500">
            v{h.cr9cd_version} · {h.createdon ? new Date(h.createdon).toLocaleDateString() : '—'}
          </span>
        </div>
      ),
    },
    {
      key: 'active',
      header: 'Active',
      render: (h) =>
        h.cr9cd_is_active ? <Badge tone="red">Active</Badge> : <Badge tone="zinc" status="inactive">Inactive</Badge>,
    },
    { key: 'created', header: 'Created', render: (h) => (h.createdon ? new Date(h.createdon).toLocaleString() : '—') },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (h) => {
        if (confirmDeleteId === h.cr9cd_scoringconfigid) {
          return (
            <div className="flex items-center justify-end gap-1.5">
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await deleteScoringConfig(h.cr9cd_scoringconfigid);
                    setConfirmDeleteId(null);
                    await load();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </Button>
            </div>
          );
        }
        return (
          <div className="flex items-center justify-end gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => loadConfig(h)}>
              Load
            </Button>
            {!h.cr9cd_is_active && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await activateScoringConfig(h.cr9cd_scoringconfigid);
                    await load();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Activate
              </Button>
            )}
            {!h.cr9cd_is_active && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDeleteId(h.cr9cd_scoringconfigid)}>
                Delete
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Scoring Engine"
        subtitle="Tune the factor weights and parameters that drive priority ranking."
        actions={
          activeVersion != null ? (
            <Badge tone="blue">Currently active: v{activeVersion}</Badge>
          ) : undefined
        }
      />

      <div className="card mb-6 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Factor weights</h2>
          <span className={`text-sm tabular-nums ${totalOk ? 'text-slate-600' : 'text-rose-600'}`}>
            Total: {totalWeight.toFixed(2)}
          </span>
        </div>
        <div className="space-y-3">
          {FACTOR_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-4">
              <label className="w-56 shrink-0 text-sm text-slate-600">{FACTOR_LABELS[key]}</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={weights[key]}
                onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) })}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-600"
              />
              <span className="w-12 shrink-0 text-right text-sm tabular-nums text-slate-700">{weights[key].toFixed(2)}</span>
            </div>
          ))}
        </div>

        <h2 className="mb-3 mt-6 text-sm font-semibold text-slate-900">Parameters</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {paramFields.map((f) => (
            <div key={f.key} className="flex items-center gap-4">
              <label className="w-56 shrink-0 text-sm text-slate-600">{f.label}</label>
              <input
                type="number"
                step={f.step}
                min={f.min}
                max={f.max}
                value={params[f.key]}
                onChange={(e) => setParams({ ...params, [f.key]: Number(e.target.value) })}
                className="input max-w-[8rem]"
              />
            </div>
          ))}
        </div>

        <div className="mt-6">
          <Button disabled={busy} loading={busy} onClick={saveAndActivate}>
            Save &amp; activate new version
          </Button>
        </div>
      </div>

      <h2 className="mb-1 text-sm font-semibold text-slate-900">Saved configurations</h2>
      <p className="mb-3 text-xs text-slate-500">Load a configuration to pull its weights &amp; parameters into the editor above. Non-active versions can be deleted.</p>
      <DataTable columns={columns} rows={history} keyFn={(h) => h.cr9cd_scoringconfigid} emptyTitle="No versions yet" />
    </div>
  );
}
