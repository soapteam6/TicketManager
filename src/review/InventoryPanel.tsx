import { useState } from 'react';
import { Modal } from '../components/Modal';
import { useReview } from './context';
import { isoToLocalDateTimeInput, localDateTimeInputToIso, timeZoneLabel } from './dates';
import { interestPeople } from './interestPeople';
import { CrmBeneficiaryPicker } from './CrmBeneficiaryPicker';
import { personName } from './personName';
import type { CrmBeneficiary, Inventory, InventoryView, ReleaseCommand } from './types';
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
import { scopedWindowIds } from './inventoryNavigation';

export function InventoryForm({ close, defaultSeasonId = '', game }: { close: () => void; defaultSeasonId?: string; game?: InventoryView }) {
  const { snapshot, run, busy } = useReview(),
    [kind, setKind] = useState<'game' | 'event'>(game?.kind ?? (defaultSeasonId ? 'game' : 'event'));
  const [seasonId, setSeasonId] = useState(game?.seasonId ?? defaultSeasonId);
  const hasHistory = !!game && (snapshot.requests.some(r => r.gameId === game.id) || snapshot.allocations?.some(a => a.gameId === game.id));
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
            ...(game ? { type: 'editInventory' as const, gameId: game.id, status: value(form, 'status') as Inventory['status'] } : { type: 'createInventory' as const }),
            kind,
            title: value(form, 'title'),
            gameDate: localDateTimeInputToIso(value(form, 'date')),
            tickets: number(form, 'tickets'),
            seasonId: kind === 'game' ? seasonId : undefined,
          }))
        )
          close();
      }}
    >
      <FormError />
      <Field label="Inventory type">
        <Select
          name="kind" disabled={hasHistory}
          value={kind}
          onChange={(e) => setKind(e.target.value as 'game' | 'event')}
        >
          <option value="event">Dated event — no season required</option>
          <option value="game">Sports game — season inventory</option>
        </Select>
      </Field>
      <Field label="Title / opponent" required>
        <TextInput name="title" defaultValue={game?.title} required maxLength={200} />
      </Field>
      {kind === 'game' && (
        <Field label="Season" required>
          <Select
            name="season"
            disabled={hasHistory}
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
        <Field label={`Event date and time (${timeZoneLabel()})`} required>
          <TextInput name="date" type="datetime-local" defaultValue={game ? isoToLocalDateTimeInput(game.gameDate) : undefined} required />
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
              game?.totalTickets ?? (kind === 'game' ? (selectedTeam?.defaultTickets ?? 4) : 4)
            }
            required
          />
        </Field>
      </div>
      {game && <Field label="Event status"><Select name="status" defaultValue={game.status}><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></Select></Field>}
      <p className="text-sm text-slate-600">{game ? 'Existing requests and allocation history are retained. Tickets with allocation history cannot be removed.' : 'Creates private inventory. Release it separately in Event inventory.'}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {game ? 'Save event' : 'Create private inventory'}
        </Button>
      </div>
    </form>
  );
}
export function InterestForm({ game, close }: { game: InventoryView; close: () => void }) {
  const { snapshot, provider, run, busy } = useReview();
  const admin = snapshot.persona.role === 'coordinator';
  const [purpose, setPurpose] = useState<'employee' | 'customer'>(snapshot.persona.key === 'employee' ? 'employee' : 'customer');
  const [onBehalfContactId, setOnBehalfContactId] = useState('');
  const [source, setSource] = useState<'crm' | 'saved'>(provider.crm ? 'crm' : 'saved');
  const [business, setBusiness] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [crmContacts, setCrmContacts] = useState<CrmBeneficiary[]>([]);
  const [quantity, setQuantity] = useState(1);
  const { employees, own, requester } = interestPeople(snapshot, onBehalfContactId);
  const customers = snapshot.options.filter(c => c.type === 'customer' && c.company === business);
  const matches = customers.filter(c => `${c.name} ${c.email}`.toLowerCase().includes(query.toLowerCase())).slice(0, 25);
  const recipients = purpose === 'employee' ? (requester ? [requester.id] : []) : source === 'saved' ? selected : [];
  const recipientCount = purpose === 'customer' && source === 'crm' ? crmContacts.length : recipients.length;
  return <form className="space-y-4" onSubmit={async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (await run({ type: 'interest', gameId: game.id, purpose, contactIds: recipients,
      crmContacts: purpose === 'customer' && source === 'crm' ? crmContacts : undefined,
      quantity, rationale: value(form, 'rationale'), opportunity: value(form, 'opportunity'),
      onBehalfContactId: admin ? onBehalfContactId || undefined : undefined,
    })) close();
  }}>
    <FormError />
    <p className="text-sm">{dateTime(game.gameDate)} · {game.availableTickets} / {game.totalTickets} tickets available.</p>
    {admin && <Field label="Requesting person"><Select name="onBehalfContactId" value={onBehalfContactId} onChange={e => setOnBehalfContactId(e.target.value)}>
      <option value="">{personName(snapshot.persona.name)} — {snapshot.persona.email} (self)</option>
      {employees.filter(c => c.id !== own?.id).map(c => <option key={c.id} value={c.id}>{personName(c.name)} — {c.email || `No email (ID ${c.id.slice(-8)})`}</option>)}
    </Select></Field>}
    <div className="grid sm:grid-cols-2 gap-4">
      <Field label="Purpose"><Select name="purpose" value={purpose} onChange={e => setPurpose(e.target.value as 'employee' | 'customer')}>
        <option value="employee">Employee / self</option>
        {snapshot.persona.key !== 'employee' && <option value="customer">Customer / prospect</option>}
      </Select></Field>
      <Field label="Requested tickets" required><TextInput name="quantity" type="number" value={quantity} onChange={e => setQuantity(e.target.valueAsNumber)} min={1} max={100} step={1} required /></Field>
    </div>
    {purpose === 'employee' ? <section aria-label="Employee beneficiary" className="rounded-lg border border-slate-200 p-3 text-sm">
      <strong>Beneficiary</strong>
      {requester ? <div className="mt-2"><span>{personName(requester.name)}</span><span className="block text-xs text-slate-600">{requester.email || 'No email recorded'}</span></div>
        : <p className="mt-2 text-amber-800">The requesting person needs an active employee contact before recording self interest.</p>}
    </section> : <>
      <Field label="Contact source"><Select name="contactSource" value={source} onChange={e => setSource(e.target.value as 'crm' | 'saved')}>
        {provider.crm && <option value="crm">CRM contacts</option>}<option value="saved">Saved contacts</option>
      </Select></Field>
      {source === 'crm' ? <CrmBeneficiaryPicker selected={crmContacts} onChange={setCrmContacts} /> : <>
        <Field label="Customer business"><Select value={business} onChange={e => { setBusiness(e.target.value); setSelected([]); setQuery(''); }}>
          <option value="">Choose a business</option>{[...new Set(snapshot.options.filter(c => c.type === 'customer').map(c => c.company))].sort().map(c => <option key={c}>{c}</option>)}
        </Select></Field>
        {business && <><Field label="Find saved contacts"><TextInput value={query} onChange={e => setQuery(e.target.value)} placeholder="Name or email" /></Field>
          <fieldset className="rounded-lg border border-slate-200 p-3"><legend className="px-1 text-sm font-medium">Beneficiaries</legend>
            <div className="max-h-48 overflow-y-auto">{matches.map(c => <label key={c.id} className="flex cursor-pointer gap-3 py-2 text-sm"><input type="checkbox" name="contacts" value={c.id} checked={selected.includes(c.id)} onChange={e => setSelected(e.target.checked ? [...selected, c.id] : selected.filter(id => id !== c.id))} className="mt-1" /><span>{personName(c.name)}<span className="block text-xs text-slate-600">{c.email || 'No email recorded'}</span></span></label>)}{!matches.length && <p className="text-sm text-slate-500">No matching contacts.</p>}</div>
          </fieldset>
          {customers.length > 25 && <p className="text-xs text-slate-500">Showing up to 25 matches. Refine your search.</p>}
          {selected.length > 0 && <div aria-label="Selected saved contacts" className="max-h-32 overflow-y-auto rounded border border-slate-200 p-3 text-sm"><strong>{selected.length} selected</strong>{selected.map(id => { const c = customers.find(p => p.id === id)!; return <div key={id} className="mt-2 flex justify-between gap-3"><span>{personName(c.name)}<span className="block text-xs text-slate-500">{c.email}</span></span><button type="button" className="text-xs underline" onClick={() => setSelected(selected.filter(p => p !== id))}>Remove</button></div>; })}</div>}
        </>}
      </>}
    </>}
    {recipientCount > quantity && <p role="alert" className="text-sm text-red-700">Request at least one ticket per selected person.</p>}
    <Field label="Related opportunity / value context (optional)"><TextInput name="opportunity" maxLength={200} placeholder="Opportunity or MRR context for coordinator review" /></Field>
    <Field label="Business justification" required><TextArea name="rationale" required maxLength={1000} rows={3} placeholder="Briefly explain the purpose of this visit." /></Field>
    <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={close}>Cancel</Button><Button type="submit" disabled={busy || !recipientCount || recipientCount > quantity}>Record interest</Button></div>
  </form>;
}
export function ReleasePanel({
  selected,
  clear,
  inventoryIds,
}: {
  selected: string[];
  clear: () => void;
  inventoryIds?: string[];
}) {
  const { run, busy, snapshot } = useReview(),
    [scope, setScope] = useState('selected'),
    [action, setAction] = useState<ReleaseCommand['action']>('released');
  return (
    <Panel
      title="Control inventory visibility"
      description="Release individual selections, batches or an inclusive local date window. Announcements are a separate coordinator choice."
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
                : inventoryIds ? { ids: scopedWindowIds(snapshot.catalog, inventoryIds, localDateTimeInputToIso(value(form, 'from')), localDateTimeInputToIso(value(form, 'through'))) } : {
                    from: localDateTimeInputToIso(value(form, 'from')),
                    through: localDateTimeInputToIso(value(form, 'through')),
                  }),
              action,
              at:
                action === 'scheduled'
                  ? localDateTimeInputToIso(value(form, 'at'))
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
              <option value="window">Date window</option>
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
            <Field label={`Release at (${timeZoneLabel()})`} required>
              <TextInput name="at" type="datetime-local" required />
            </Field>
          )}
        </div>
        {scope === 'window' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={`Event window from (${timeZoneLabel()})`} required>
              <TextInput type="datetime-local" name="from" required />
            </Field>
            <Field label={`Event window through (${timeZoneLabel()}, inclusive)`} required>
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
