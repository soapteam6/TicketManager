import { useState } from 'react';
import { Modal } from '../components/Modal';
import { useReview } from './context';
import { utcDateTimeInputToIso } from './dates';
import { PERSONAS } from './fixtures';
import type { InventoryView, ReleaseCommand } from './types';
import {
  Badge,
  Button,
  Empty,
  Field,
  FormError,
  Panel,
  Select,
  TextArea,
  TextInput,
} from './ui';
import { dateTime, number, value } from './form';

function InventoryForm({ close }: { close: () => void }) {
  const { snapshot, run, busy } = useReview(),
    [kind, setKind] = useState<'game' | 'event'>('event');
  const [seasonId, setSeasonId] = useState('');
  const selectedTeam = snapshot.teams.find(
    (t) => t.id === snapshot.seasons.find((s) => s.id === seasonId)?.teamId,
  );
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        if (
          await run(() => ({
            type: 'createInventory',
            kind,
            title: value(form, 'title'),
            gameDate: utcDateTimeInputToIso(value(form, 'date')),
            tickets: number(form, 'tickets'),
            seasonId: kind === 'game' ? value(form, 'season') : undefined,
          }))
        )
          close();
      }}
    >
      <FormError />
      <Field label="Inventory type">
        <Select
          value={kind}
          onChange={(e) => setKind(e.target.value as 'game' | 'event')}
        >
          <option value="event">Dated event — no season required</option>
          <option value="game">Sports game — season inventory</option>
        </Select>
      </Field>
      <Field label="Title / opponent" required>
        <TextInput name="title" required maxLength={200} />
      </Field>
      {kind === 'game' && (
        <Field label="Season" required>
          <Select
            name="season"
            value={seasonId}
            onChange={(e) => setSeasonId(e.target.value)}
            required
          >
            <option value="">Choose a season</option>
            {snapshot.seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {snapshot.teams.find((t) => t.id === s.teamId)?.name} ·{' '}
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Event date and time (UTC)" required>
          <TextInput name="date" type="datetime-local" required />
        </Field>
        <Field label="Ticket inventory" required>
          <TextInput
            key={`${kind}-${seasonId}`}
            name="tickets"
            type="number"
            min={0}
            max={1000}
            step={1}
            defaultValue={
              kind === 'game' ? (selectedTeam?.defaultTickets ?? 4) : 4
            }
            required
          />
        </Field>
      </div>
      <p className="text-sm text-slate-600">
        Creates private inventory. No requests, releases or messages are sent
        automatically.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          Create private inventory
        </Button>
      </div>
    </form>
  );
}
function InterestForm({
  game,
  close,
}: {
  game: InventoryView;
  close: () => void;
}) {
  const { snapshot, run, busy } = useReview(),
    admin = snapshot.persona.role === 'coordinator';
  const [purpose, setPurpose] = useState<'employee' | 'customer'>(
    snapshot.persona.key === 'employee' ? 'employee' : 'customer',
  );
  const [business, setBusiness] = useState('');
  const contacts = snapshot.options.filter(
    (c) =>
      c.type === purpose &&
      (purpose === 'employee' || !business || c.company === business),
  );
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        if (
          await run({
            type: 'interest',
            gameId: game.id,
            purpose,
            contactIds: form.getAll('contacts').map(String),
            quantity: number(form, 'quantity'),
            rationale: value(form, 'rationale'),
            opportunity: value(form, 'opportunity'),
            onBehalfOf: admin
              ? value(form, 'onBehalfOf') || undefined
              : undefined,
          })
        )
          close();
      }}
    >
      <FormError />
      <p className="text-sm">
        {dateTime(game.gameDate)} · {game.availableTickets} /{' '}
        {game.totalTickets} tickets available. Interest never holds tickets.
      </p>
      {admin && (
        <Field label="Requesting person">
          <Select name="onBehalfOf">
            <option value="">Demo Coordinator (self)</option>
            {Object.values(PERSONAS)
              .filter((p) => p.role === 'requester')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — on behalf
                </option>
              ))}
          </Select>
        </Field>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Purpose">
          <Select
            value={purpose}
            onChange={(e) => {
              setPurpose(e.target.value as 'employee' | 'customer');
              setBusiness('');
            }}
          >
            <option value="employee">Employee / self</option>
            {snapshot.persona.key !== 'employee' && (
              <option value="customer">Customer / prospect</option>
            )}
          </Select>
        </Field>
        <Field label="Requested tickets" required>
          <TextInput
            name="quantity"
            type="number"
            defaultValue={1}
            min={1}
            max={100}
            step={1}
            required
          />
        </Field>
      </div>
      {purpose === 'customer' && (
        <Field label="Customer business">
          <Select
            value={business}
            onChange={(e) => setBusiness(e.target.value)}
          >
            <option value="">Choose a business</option>
            {[
              ...new Set(
                snapshot.options
                  .filter((c) => c.type === 'customer')
                  .map((c) => c.company),
              ),
            ].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      )}
      <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium">
          Active beneficiaries — choose at least one
        </legend>
        {!contacts.length && (
          <Empty>
            No active people available. A coordinator can review app and
            directory eligibility.
          </Empty>
        )}
        {contacts
          .filter(() => purpose === 'employee' || Boolean(business))
          .map((c) => (
            <label key={c.id} className="flex gap-3 items-start text-sm py-1">
              <input
                type="checkbox"
                name="contacts"
                value={c.id}
                className="mt-1"
              />
              <span>
                {c.name}
                <span className="block text-xs text-slate-500">
                  {c.company} · {c.phone || 'No phone recorded'}
                </span>
              </span>
            </label>
          ))}
        {purpose === 'customer' && !business && (
          <p className="text-sm text-slate-600">
            Choose a business to see its active contacts.
          </p>
        )}
      </fieldset>
      <Field label="Related opportunity / value context (optional)">
        <TextInput
          name="opportunity"
          maxLength={200}
          placeholder="Opportunity or MRR context for coordinator review"
        />
      </Field>
      <Field label="Business justification" required>
        <TextArea
          name="rationale"
          required
          maxLength={1000}
          rows={3}
          placeholder="Briefly explain the purpose of this visit."
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !contacts.length}>
          Record interest
        </Button>
      </div>
    </form>
  );
}
function ReleasePanel({
  selected,
  clear,
}: {
  selected: string[];
  clear: () => void;
}) {
  const { run, busy } = useReview(),
    [scope, setScope] = useState('selected'),
    [action, setAction] = useState<ReleaseCommand['action']>('released');
  return (
    <Panel
      title="Control inventory visibility"
      description="Release individual selections, batches or an inclusive UTC date window. Announcements are a separate coordinator choice."
    >
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          if (
            await run(() => ({
              type: 'release',
              ...(scope === 'selected'
                ? { ids: selected }
                : {
                    from: utcDateTimeInputToIso(value(form, 'from')),
                    through: utcDateTimeInputToIso(value(form, 'through')),
                  }),
              action,
              at:
                action === 'scheduled'
                  ? utcDateTimeInputToIso(value(form, 'at'))
                  : undefined,
            }))
          )
            clear();
        }}
      >
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Release scope">
            <Select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="selected">
                Selected inventory ({selected.length})
              </option>
              <option value="window">Date window (UTC)</option>
            </Select>
          </Field>
          <Field label="Visibility">
            <Select
              value={action}
              onChange={(e) =>
                setAction(e.target.value as ReleaseCommand['action'])
              }
            >
              <option value="released">Release now</option>
              <option value="scheduled">Schedule release</option>
              <option value="private">Keep / return private</option>
            </Select>
          </Field>
          {action === 'scheduled' && (
            <Field label="Release at (UTC)" required>
              <TextInput name="at" type="datetime-local" required />
            </Field>
          )}
        </div>
        {scope === 'window' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Event window from (UTC)" required>
              <TextInput type="datetime-local" name="from" required />
            </Field>
            <Field label="Event window through (UTC, inclusive)" required>
              <TextInput type="datetime-local" name="through" required />
            </Field>
          </div>
        )}
        <Button
          type="submit"
          variant="secondary"
          disabled={busy || (scope === 'selected' && !selected.length)}
        >
          Save visibility
        </Button>
      </form>
    </Panel>
  );
}
export function InventoryPanel() {
  const { snapshot } = useReview(),
    admin = snapshot.persona.role === 'coordinator';
  const [create, setCreate] = useState(false),
    [interest, setInterest] = useState<InventoryView | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [filter, setFilter] = useState('upcoming');
  const items = snapshot.catalog.filter(
    (g) => filter === 'all' || g.status === 'scheduled',
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            {admin ? 'Inventory & releases' : 'Available events'}
          </h2>
          <p className="text-sm text-slate-600">
            {admin
              ? 'Private preparation and public availability in one view.'
              : 'Available tickets can change. Compare demand before expressing interest.'}
          </p>
        </div>
        {admin && (
          <div className="flex gap-3 items-end">
            <Field label="Show inventory">
              <Select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="upcoming">Scheduled</option>
                <option value="all">All, including history</option>
              </Select>
            </Field>
            <Button onClick={() => setCreate(true)}>Add inventory</Button>
          </div>
        )}
      </div>
      {admin && (
        <ReleasePanel selected={selected} clear={() => setSelected([])} />
      )}
      {!items.length && (
        <Empty>
          No released upcoming inventory yet. Check back after a coordinator
          releases tickets. Your existing interest remains under My interest.
        </Empty>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((game) => (
          <article
            key={game.id}
            className="card p-5 flex flex-col gap-4"
            aria-label={game.title}
          >
            <div className="flex items-center justify-between gap-2">
              <Badge>
                {game.kind === 'event'
                  ? 'Dated event'
                  : (game.seasonLabel ?? 'Sports game')}
              </Badge>
              {admin && (
                <label className="text-xs flex gap-2 items-center">
                  <input
                    type="checkbox"
                    aria-label={`Select ${game.title}`}
                    checked={selected.includes(game.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, game.id]
                          : selected.filter((id) => id !== game.id),
                      )
                    }
                  />
                  Select
                </label>
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {game.title}
              </h3>
              <p className="text-sm text-slate-600">
                {dateTime(game.gameDate)}
              </p>
            </div>
            {admin && (
              <div className="text-sm">
                <Badge>
                  {game.released
                    ? 'Released'
                    : game.release === 'scheduled'
                      ? 'Release scheduled'
                      : 'Private'}
                </Badge>
                {game.releaseAt && (
                  <p className="mt-1 text-xs">
                    Release at {dateTime(game.releaseAt)}
                  </p>
                )}
              </div>
            )}
            <p className="text-2xl font-semibold text-brand-700">
              {game.availableTickets}
              <span className="text-sm text-slate-600 font-normal">
                {' '}
                / {game.totalTickets} tickets available
              </span>
            </p>
            <dl className="grid grid-cols-3 gap-2 border-y border-slate-100 py-3 text-center">
              <div>
                <dt className="text-xs text-slate-500">Requests</dt>
                <dd className="font-semibold">{game.requestCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Requesting people</dt>
                <dd className="font-semibold">{game.requestingPeople}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Tickets requested</dt>
                <dd className="font-semibold">{game.requestedTickets}</dd>
              </div>
            </dl>
            <p className="text-xs text-slate-500">
              Totals count interest, including fulfilled requests. People counts
              requesting employees, not beneficiaries.
            </p>
            {game.status === 'scheduled' && (
              <Button
                variant="secondary"
                className="mt-auto"
                onClick={() => setInterest(game)}
              >
                {admin ? 'Enter interest / on behalf' : 'Express interest'}
              </Button>
            )}
          </article>
        ))}
      </div>
      <Modal
        open={create}
        onClose={() => setCreate(false)}
        title="Add private inventory"
        description="Use invented examples only."
      >
        <InventoryForm close={() => setCreate(false)} />
      </Modal>
      <Modal
        open={Boolean(interest)}
        onClose={() => setInterest(null)}
        title={`Interest · ${interest?.title ?? ''}`}
        description="Interest is a request, never an automatic allocation."
      >
        {interest && (
          <InterestForm game={interest} close={() => setInterest(null)} />
        )}
      </Modal>
    </div>
  );
}
