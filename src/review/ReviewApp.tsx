import { useState, useSyncExternalStore } from 'react';
import { ReviewContext } from './context';
import { PERSONAS } from './fixtures';
import { utcDateTimeInputToIso } from './dates';
import type { PersonaKey, ReviewCommand, ReviewProvider } from './types';
import { Button, Field, Select, TextInput } from './ui';
import { dateTime, value } from './form';
import { InventoryPanel } from './InventoryPanel';
import { RequestsPanel, FollowthroughPanel } from './RequestsPanel';
import { PeoplePanel } from './PeoplePanel';
import { SetupPanel } from './SetupPanel';
import { MessagesPanel, ScoringPanel } from './SettingsPanels';
const views = [
  'Inventory',
  'Requests',
  'Transfer & attendance',
  'Contacts & history',
  'Setup & import',
  'Scoring',
  'Mock messages',
] as const;
type View = (typeof views)[number];
export function ReviewApp({
  provider,
  now,
  onClock,
}: {
  provider: ReviewProvider;
  now?: number;
  onClock?: (now: number) => void;
}) {
  const [persona, setPersona] = useState<PersonaKey>('coordinator');
  const [view, setView] = useState<View>('Inventory');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  useSyncExternalStore(
    provider.subscribe,
    provider.revision,
    provider.revision,
  );
  const snapshot = provider.snapshot(persona),
    admin = snapshot.persona.role === 'coordinator';
  async function run(input: ReviewCommand | (() => ReviewCommand)) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await provider.execute(
        persona,
        typeof input === 'function' ? input() : input,
      );
      setMessage(result.message);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (provider.mode === 'platform-unavailable')
    return (
      <section className="card p-6 space-y-4">
        <h1 className="text-2xl font-semibold">
          Review workflow — integration pending
        </h1>
        <p>
          The review screens require approved Dataverse release storage,
          unknown-attendance representation, role authorization and atomic
          allocation operations. Generated schemas have been preserved.
        </p>
        <p>
          Run <code>npm run dev:review</code> in a local checkout for the
          isolated synthetic demo. It requires no platform login. Existing Code
          App screens retain their current integration behavior.
        </p>
        <p className="text-sm text-slate-600">
          The demo role selector and in-memory transactions do not provide
          production security or concurrency.
        </p>
      </section>
    );
  return (
    <ReviewContext value={{ provider, snapshot, persona, busy, error, run }}>
      <div className="min-h-screen bg-slate-100">
        <div className="bg-amber-100 px-4 py-2 text-center text-xs text-amber-950">
          LOCAL SYNTHETIC REVIEW · Memory only · No real identity, delivery or
          outbound messages · Demo personas are not production authorization
        </div>
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 flex flex-wrap gap-4 items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-brand-700 font-semibold">
                Ticket Manager
              </p>
              <h1 className="text-2xl font-semibold text-slate-950">
                {admin ? 'Coordinator workspace' : 'Find your next event'}
              </h1>
              <p className="text-sm text-slate-600">
                {admin
                  ? 'Prepare inventory. Review interest. Make the call.'
                  : 'Express interest. A coordinator will decide allocations.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              <Field label="Synthetic persona">
                <Select
                  value={persona}
                  onChange={(e) => {
                    setPersona(e.target.value as PersonaKey);
                    setView('Inventory');
                    setMessage('');
                    setError('');
                  }}
                >
                  {Object.values(PERSONAS).map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="secondary"
                onClick={() => window.location.reload()}
              >
                Reset synthetic demo
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-5">
          {now !== undefined && onClock && admin && (
            <details className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                Demo clock: {dateTime(new Date(now).toISOString())}
              </summary>
              <form
                className="mt-3 flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  try {
                    onClock(
                      Date.parse(
                        utcDateTimeInputToIso(
                          value(new FormData(e.currentTarget), 'clock'),
                        ),
                      ),
                    );
                    setError('');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                <Field label="Demo clock (UTC)">
                  <TextInput
                    type="datetime-local"
                    name="clock"
                    required
                    defaultValue={new Date(now).toISOString().slice(0, 16)}
                  />
                </Field>
                <Button type="submit" variant="secondary">
                  Apply demo time
                </Button>
                <p>
                  Scheduled visibility is evaluated at this instant; no external
                  scheduler runs.
                </p>
              </form>
            </details>
          )}
          <nav aria-label="Workflow" className="flex flex-wrap gap-2">
            {views
              .filter((v) => admin || v === 'Inventory' || v === 'Requests')
              .map((v) => (
                <Button
                  key={v}
                  variant={view === v ? 'primary' : 'secondary'}
                  aria-current={view === v ? 'page' : undefined}
                  onClick={() => {
                    setView(v);
                    setMessage('');
                    setError('');
                  }}
                >
                  {v === 'Requests' && !admin ? 'My interest' : v}
                </Button>
              ))}
          </nav>
          <div aria-live="polite">
            {busy && (
              <p role="status" className="text-sm text-slate-600">
                Saving local mock change…
              </p>
            )}
            {message && (
              <p
                role="status"
                className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"
              >
                {message}
              </p>
            )}
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"
            >
              {error}
            </p>
          )}
          {view === 'Inventory' && <InventoryPanel />}
          {view === 'Requests' && <RequestsPanel />}
          {admin && view === 'Transfer & attendance' && <FollowthroughPanel />}
          {admin && view === 'Contacts & history' && <PeoplePanel />}
          {admin && view === 'Setup & import' && <SetupPanel />}
          {admin && view === 'Scoring' && <ScoringPanel />}
          {admin && view === 'Mock messages' && <MessagesPanel />}
          <footer className="border-t border-slate-200 py-4 text-xs text-slate-500">
            Synthetic examples only. All event and release times show UTC.
            Season boundaries are calendar dates. Reload resets fixtures, clock
            and local outbox; each tab is independent.
          </footer>
        </main>
      </div>
    </ReviewContext>
  );
}
