import { useState } from 'react';
import { useReview } from './context';
import type { SchedulePreview } from './types';
import { Button, Empty, Field, Panel, Select, TextArea, TextInput } from './ui';
import { dateTime, number, value } from './form';
const sample =
  'date,time,title,tickets,kind\n2027-01-10,03:00,Synthetic Comets · Preview Opponent,4,game\n2027-01-15,02:00,Synthetic Community Performance,2,event';
export function SetupPanel() {
  const { snapshot, provider, persona, run, busy } = useReview(),
    [csv, setCsv] = useState(sample),
    [preview, setPreview] = useState<SchedulePreview | null>(null);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Team setup"
          description="Sports inventory uses teams and seasons. Ad hoc dated events do not need a season."
        >
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              if (
                await run({
                  type: 'createTeam',
                  name: value(f, 'name'),
                  defaultTickets: number(f, 'tickets'),
                })
              )
                form.reset();
            }}
          >
            <Field label="Synthetic team name" required>
              <TextInput name="name" required maxLength={200} />
            </Field>
            <Field label="Default ticket count" required>
              <TextInput
                name="tickets"
                type="number"
                min={0}
                max={1000}
                defaultValue={4}
                required
              />
            </Field>
            <Button type="submit" disabled={busy}>
              Add team
            </Button>
          </form>
        </Panel>
        <Panel
          title="Season setup"
          description="Season boundaries are date-only calendar values, with no timezone conversion."
        >
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              if (
                await run({
                  type: 'createSeason',
                  teamId: value(f, 'team'),
                  label: value(f, 'label'),
                  startDate: value(f, 'start'),
                  endDate: value(f, 'end'),
                })
              )
                form.reset();
            }}
          >
            <Field label="Team" required>
              <Select name="team" required>
                {snapshot.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Season label" required>
              <TextInput
                name="label"
                required
                maxLength={200}
                placeholder="2027–28 Synthetic"
              />
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Start calendar date" required>
                <TextInput name="start" type="date" required />
              </Field>
              <Field label="End calendar date" required>
                <TextInput name="end" type="date" required />
              </Field>
            </div>
            <Button type="submit" disabled={busy}>
              Add season
            </Button>
          </form>
        </Panel>
      </div>
      <Panel
        title="Preview a schedule import"
        description="Paste a local CSV. Deterministic parsing only; no AI API, paid service or external schedule lookup. Times are UTC; every imported item starts private."
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setPreview(provider.previewSchedule(persona, csv));
          }}
        >
          <Field
            label="CSV: date,time,title,tickets,kind"
            hint="Use YYYY-MM-DD and 24-hour HH:mm in UTC. Quoted titles and doubled quotes are supported; multiline cells are not."
          >
            <TextArea
              rows={7}
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setPreview(null);
              }}
              spellCheck={false}
            />
          </Field>
          <Button type="submit" variant="secondary">
            Preview CSV
          </Button>
        </form>
        {preview && (
          <div className="space-y-3">
            <h3 className="font-semibold">
              Preview · {preview.rows.length} valid rows · nothing published
            </h3>
            {preview.errors.map((error) => (
              <p key={error} role="alert" className="text-sm text-rose-800">
                {error}
              </p>
            ))}
            {!preview.rows.length && (
              <Empty>No valid rows. Correct the CSV before importing.</Empty>
            )}
            <ul className="space-y-2 text-sm">
              {preview.rows.map((row, i) => (
                <li key={i} className="rounded-lg bg-slate-50 p-3">
                  {row.title} · {dateTime(row.gameDate)} · {row.tickets} tickets
                  · {row.kind}
                </li>
              ))}
            </ul>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await run({
                    type: 'importSchedule',
                    csv,
                    seasonId: value(new FormData(e.currentTarget), 'season'),
                  })
                )
                  setPreview(null);
              }}
            >
              <Field label="Season for sports rows">
                <Select name="season" required>
                  {snapshot.seasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                type="submit"
                disabled={
                  busy || Boolean(preview.errors.length) || !preview.rows.length
                }
              >
                Import as private inventory
              </Button>
            </form>
          </div>
        )}
      </Panel>
      <Panel title="Existing teams & seasons">
        <ul className="space-y-3 text-sm">
          {snapshot.teams.map((t) => (
            <li key={t.id}>
              <strong>{t.name}</strong> · default {t.defaultTickets} tickets
              <ul className="mt-1 space-y-1">
                {snapshot.seasons
                  .filter((s) => s.teamId === t.id)
                  .map((s) => (
                    <li key={s.id}>
                      {s.label} · {s.startDate} through {s.endDate} (calendar
                      dates)
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
