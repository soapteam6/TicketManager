import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FACTOR_KEYS,
  FACTOR_LABELS,
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_SCORING_PARAMS,
  type FactorKey,
  type ScoringParams,
} from '@ais/shared';
import { api } from '@/lib/api';
import type { ScoringConfig } from '@/lib/types';
import { pickArray, pickObject, parseMaybeJson } from '@/lib/unwrap';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState, ErrorNote } from '@/components/QueryState';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Field, TextInput } from '@/components/Field';
import { RoleGate } from '@/auth/AuthContext';

type Weights = Record<FactorKey, number>;

function normalizeConfig(c: ScoringConfig | null) {
  if (!c) return null;
  const weights = (parseMaybeJson<Weights>(c.weights as string | Weights) ?? DEFAULT_SCORING_WEIGHTS) as Weights;
  const params = (parseMaybeJson<ScoringParams>(c.params as string | ScoringParams) ?? DEFAULT_SCORING_PARAMS) as ScoringParams;
  return { ...c, weightsObj: weights, paramsObj: params };
}

export function ScoringConfigPage() {
  const qc = useQueryClient();

  const active = useQuery({
    queryKey: ['scoring', 'active'],
    queryFn: async () => normalizeConfig(pickObject<ScoringConfig>((await api.get('/scoring/configs/active')).data, 'config')),
  });

  const list = useQuery({
    queryKey: ['scoring', 'configs'],
    queryFn: async () => pickArray<ScoringConfig>((await api.get('/scoring/configs')).data, 'configs'),
  });

  const [name, setName] = useState('');
  const [weights, setWeights] = useState<Weights>(DEFAULT_SCORING_WEIGHTS);
  const [params, setParams] = useState<ScoringParams>(DEFAULT_SCORING_PARAMS);
  const [loadedId, setLoadedId] = useState<number | null>(null);

  // Seed the editor from the active config once it loads.
  useEffect(() => {
    if (active.data) {
      setWeights(active.data.weightsObj);
      setParams(active.data.paramsObj);
      setName(`${active.data.name} (copy)`);
      setLoadedId(active.data.id);
    }
  }, [active.data]);

  // Load a saved/archived config's weights and parameters into the editor.
  function loadConfig(c: ScoringConfig) {
    const n = normalizeConfig(c);
    if (!n) return;
    setWeights(n.weightsObj);
    setParams(n.paramsObj);
    setName(`${c.name} (copy)`);
    setLoadedId(c.id);
  }

  const weightTotal = useMemo(
    () => FACTOR_KEYS.reduce((s, k) => s + (weights[k] ?? 0), 0),
    [weights]
  );

  const create = useMutation({
    mutationFn: async () =>
      (await api.post('/scoring/configs', { name, weights, params, activate: true })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scoring'] });
    },
  });

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const del = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/scoring/configs/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scoring'] });
      setConfirmDeleteId(null);
    },
  });

  return (
    <div>
      <PageHeader
        title="Scoring Engine"
        subtitle="Tune the factor weights and parameters that drive priority ranking."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-6">
          {/* Weights editor */}
          <div className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Factor weights</h3>
              <span
                className={`text-xs font-medium ${
                  Math.abs(weightTotal - 1) < 0.001 ? 'text-emerald-600' : 'text-amber-600'
                }`}
              >
                Total: {weightTotal.toFixed(2)}
              </span>
            </div>

            <div className="space-y-4">
              {FACTOR_KEYS.map((k) => (
                <div key={k}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{FACTOR_LABELS[k]}</span>
                    <span className="tabular-nums text-slate-500">{(weights[k] ?? 0).toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={weights[k] ?? 0}
                    onChange={(e) => setWeights((w) => ({ ...w, [k]: Number(e.target.value) }))}
                    className="w-full accent-brand-600"
                  />
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-400">
              Weights are relative; the engine normalizes contributions, but keeping the total near 1.00 keeps the
              breakdown intuitive.
            </p>
          </div>

          {/* Params editor */}
          <div className="card p-5">
            <h3 className="mb-4 text-sm font-semibold text-slate-800">Parameters</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Sales opp cap (USD)">
                <TextInput type="number" value={params.salesOppCapUsd} onChange={(e) => setParams((p) => ({ ...p, salesOppCapUsd: Number(e.target.value) }))} />
              </Field>
              <Field label="Fairness half-life (days)">
                <TextInput type="number" value={params.fairnessHalfLifeDays} onChange={(e) => setParams((p) => ({ ...p, fairnessHalfLifeDays: Number(e.target.value) }))} />
              </Field>
              <Field label="Lead-time sweet spot (days)">
                <TextInput type="number" value={params.leadTimeSweetSpotDays} onChange={(e) => setParams((p) => ({ ...p, leadTimeSweetSpotDays: Number(e.target.value) }))} />
              </Field>
              <Field label="Lead-time window (days)">
                <TextInput type="number" value={params.leadTimeWindowDays} onChange={(e) => setParams((p) => ({ ...p, leadTimeWindowDays: Number(e.target.value) }))} />
              </Field>
              <Field label="Target employee share (0–1)">
                <TextInput type="number" min="0" max="1" step="0.05" value={params.targetEmployeeShare} onChange={(e) => setParams((p) => ({ ...p, targetEmployeeShare: Number(e.target.value) }))} />
              </Field>
            </div>
          </div>

          {/* Create */}
          <div className="card p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <Field label="New config name" className="flex-1">
                <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 balanced" />
              </Field>
              <Button loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>
                Save &amp; activate
              </Button>
            </div>
            {create.isSuccess && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                New configuration saved and activated.
              </div>
            )}
            <ErrorNote error={create.error} />
          </div>
        </div>

        {/* Saved configurations */}
        <div className="space-y-6">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-800">Saved configurations</h3>
            <p className="mb-3 mt-1 text-xs text-slate-400">Click a configuration to load its weights &amp; parameters into the editor.</p>
            <QueryState isLoading={list.isLoading} error={list.error}>
              {list.data && list.data.length > 0 ? (
                <div className="space-y-2">
                  {list.data.map((c) => (
                    <div
                      key={c.id}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                        loadedId === c.id ? 'border-brand-400 bg-brand-50/50' : 'border-slate-200'
                      }`}
                    >
                      <button type="button" onClick={() => loadConfig(c)} className="min-w-0 flex-1 text-left transition hover:opacity-70">
                        <div className="truncate font-medium text-slate-800">{c.name}</div>
                        <div className="text-xs text-slate-400">v{c.version} · {formatDate(c.createdAt)}</div>
                      </button>
                      {confirmDeleteId === c.id ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button size="sm" variant="danger" loading={del.isPending} onClick={() => del.mutate(c.id)}>Delete</Button>
                          <Button size="sm" variant="secondary" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <div className="flex shrink-0 items-center gap-2">
                          {c.isActive ? <Badge status="active" /> : <Badge tone="zinc">Inactive</Badge>}
                          {!c.isActive && (
                            <RoleGate roles={['admin']}>
                              <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(c.id)}>Delete</Button>
                            </RoleGate>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No configurations yet.</p>
              )}
            </QueryState>
            <ErrorNote error={del.error} />
          </div>
        </div>
      </div>
    </div>
  );
}
