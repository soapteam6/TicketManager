import { findEvent } from './eventHistory';
import { useState } from 'react';
import { Modal } from '../components/Modal';
import { useReview } from './context';
import type { Contact } from './types';
import {
  Badge,
  Button,
  Empty,
  Field,
  FormError,
  Panel,
  Select,
  TextInput,
} from './ui';
import { dateTime, value } from './form';
import { personName } from './personName';
export function ContactForm({
  contact,
  close,
}: {
  contact?: Contact;
  close: () => void;
}) {
  const { run, busy, snapshot } = useReview();
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget),
          tier = value(f, 'tier');
        if (
          tier !== 'gold' &&
          tier !== 'silver' &&
          tier !== 'bronze' &&
          tier !== 'prospect'
        )
          return;
        if (
          await run({
            type: 'saveContact',
            id: contact?.id,
            contact: {
              name: value(f, 'name'),
              company: value(f, 'company'),
              email: value(f, 'email'),
              phone: value(f, 'phone'),
              tier,
            },
          })
        )
          close();
      }}
    >
      <FormError />
      <Field label="Contact name" required>
        <TextInput
          name="name"
          required
          maxLength={200}
          defaultValue={contact?.name}
        />
      </Field>
      <Field label="Business" required>
        <TextInput
          name="company"
          required
          maxLength={200}
          defaultValue={contact?.company}
        />
      </Field>
      <Field label="Email">
        <TextInput
          name="email"
          type="email"
          maxLength={200}
          defaultValue={contact?.email}
          placeholder="person@example.invalid"
        />
      </Field>
      <Field label="Phone">
        <TextInput
          name="phone"
          type="tel"
          maxLength={100}
          defaultValue={contact?.phone}
          placeholder="+1 202 555 0110"
        />
      </Field>
      <Field label="Customer category">
        <Select name="tier" defaultValue={contact?.tier ?? 'prospect'}>
          <option value="prospect">Prospect</option>
          <option value="bronze">Customer — bronze context</option>
          <option value="silver">Customer — silver context</option>
          <option value="gold">Customer — gold context</option>
        </Select>
      </Field>
      <p className="text-sm text-slate-600">
        Only customer versus prospect affects the default category score. Value
        context is reviewed by a person.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {snapshot.mode === 'dataverse' ? 'Save QA contact' : 'Save synthetic contact'}
        </Button>
      </div>
    </form>
  );
}
export function PeoplePanel() {
  const { snapshot, run, busy } = useReview(),
    [search, setSearch] = useState(''),
    [history, setHistory] = useState<Contact | null>(null),
    [editing, setEditing] = useState<Contact | null | undefined>(undefined);
  const contacts = (snapshot.contacts ?? []).filter((c) =>
    `${c.name} ${c.company} ${c.email} ${c.phone}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const allocations = (snapshot.allocations ?? []).filter(
    (a) => a.contactId === history?.id,
  );
  return (
    <Panel
      title="Contacts & cross-season history"
      description="App eligibility is independent of directory state. Inactive entries remain searchable with their complete history."
    >
      <div className="flex flex-wrap gap-3 items-end">
        <Field
          label="Search business, name, email or phone"
          className="flex-1 min-w-0"
        >
          <TextInput
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <Button onClick={() => setEditing(null)}>Add customer contact</Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => run({ type: 'syncDirectory' })}
        >
          {snapshot.mode === 'dataverse' ? 'Sync Dataverse users' : 'Sync synthetic directory'}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        {snapshot.mode === 'dataverse' ? 'Directory sync reads active users from this Dataverse environment. App-disabled contacts remain disabled. A leading # from a profile name is omitted for readability; it is not an app eligibility flag. Hover over a name to see its source spelling.' : 'Directory sync reads built-in synthetic entries only. It never changes a directory or reactivates an app-disabled person.'}
      </p>
      {!contacts.length && (
        <Empty>
          No matching contacts. Search another term or add a synthetic customer
          contact.
        </Empty>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {contacts.map((c) => {
          const known = (snapshot.allocations ?? []).filter(
            (a) => a.contactId === c.id && a.status !== 'cancelled',
          );
          return (
            <article
              key={c.id}
              className="rounded-xl border border-slate-200 p-4 space-y-3"
              aria-label={`Contact ${c.name}`}
            >
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="font-semibold" title={c.name}>{personName(c.name)}</h3>
                <Badge>
                  {c.type === 'employee'
                    ? 'Directory employee'
                    : c.tier === 'prospect'
                      ? 'Prospect'
                      : 'Customer'}
                </Badge>
              </div>
              <p className="text-sm">
                {c.company}
                <br />
                {c.email || 'No email'}
                <br />
                {c.phone || 'No phone'}
              </p>
              <p className="text-xs">
                App: {c.appActive ? 'active' : 'inactive'}
                {c.type === 'employee'
                  ? ` · Directory: ${c.directoryActive ? 'active' : 'inactive'}`
                  : ''}{' '}
                ·{' '}
                {c.appActive && c.directoryActive
                  ? 'Eligible for new selections'
                  : 'Not selectable for new requests or allocations'}
              </p>
              <p className="text-xs text-slate-600">
                Reliability:{' '}
                {known.filter((a) => a.outcome === 'attended').length} attended
                / {known.filter((a) => a.outcome === 'no_show').length}{' '}
                confirmed no-show /{' '}
                {known.filter((a) => a.outcome === 'unknown').length} unknown
                ticket outcomes. Review event evidence; no automatic exclusion.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setHistory(c)}
                >
                  View history
                </Button>
                {c.type === 'customer' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(c)}
                  >
                    Edit contact
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run({
                      type: 'contactActive',
                      contactId: c.id,
                      active: !c.appActive,
                    })
                  }
                >
                  {c.appActive ? 'Make app inactive' : 'Make app active'}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={
          editing ? 'Edit customer contact' : 'Add synthetic customer contact'
        }
        description={snapshot.mode === 'dataverse' ? 'QA contacts and history persist in AIS Development across sessions.' : 'This repository is retained across seasons in the demo session.'}
      >
        {editing !== undefined && (
          <ContactForm
            contact={editing ?? undefined}
            close={() => setEditing(undefined)}
          />
        )}
      </Modal>
      <Modal
        open={Boolean(history)}
        onClose={() => setHistory(null)}
        title={`History · ${personName(history?.name ?? '')}`}
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setHistory(null)}>
            Close history
          </Button>
        }
      >
        <div className="space-y-4">
          <p className="text-sm">
            All seasons · {history?.company} · {history?.email} ·{' '}
            {history?.phone}
          </p>
          {!allocations.length && (
            <Empty>
              No allocation history yet. Unallocated interest is retained under
              Requests.
            </Empty>
          )}
          {allocations.map((a) => {
            const game = findEvent(snapshot, a.gameId),
              changes =
                snapshot.attendanceHistory?.filter(
                  (h) => h.assignmentId === a.id,
                ) ?? [];
            return (
              <article
                key={a.id}
                className="rounded-lg border border-slate-200 p-3 space-y-2 text-sm"
              >
                <h3 className="font-semibold">{game?.title}</h3>
                {game && (
                  <p>
                    {dateTime(game.gameDate)} ·{' '}
                    {game.seasonLabel ?? 'Dated event'}
                  </p>
                )}
                <p>
                  {a.status} · {a.outcome.replaceAll('_', ' ')} ·{' '}
                  {a.evidence || 'No attendance evidence'}
                </p>
                <p>Decision: {a.decision}</p>
                <p>Manual transfer: {a.transferReference || 'Not recorded'}</p>
                {changes.length > 0 && (
                  <details>
                    <summary className="cursor-pointer">
                      Attendance audit ({changes.length})
                    </summary>
                    {changes.map((h, i) => (
                      <p key={i} className="mt-2 text-xs">
                        {dateTime(h.recordedAt)} ·{' '}
                        {h.outcome.replaceAll('_', ' ')} ·{' '}
                        {h.evidence || 'No confirmation'}
                      </p>
                    ))}
                  </details>
                )}
              </article>
            );
          })}
        </div>
      </Modal>
    </Panel>
  );
}
