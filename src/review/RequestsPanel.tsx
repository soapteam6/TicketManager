import { useState } from 'react';
import { Modal } from '../components/Modal';
import { useReview } from './context';
import type { Allocation, InterestView } from './types';
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
import { RequestIdentity } from './RequestIdentity';
import { beneficiaryNames, personName } from './personName';
import { attendanceDay, attendanceIsOpen } from './attendanceDay';
function AllocationForm({
  request,
  close,
}: {
  request: InterestView;
  close: () => void;
}) {
  const { run, busy, snapshot } = useReview(),
    game = snapshot.catalog.find((g) => g.id === request.gameId);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        if (
          await run({
            type: 'allocate',
            requestId: request.id,
            quantity: number(form, 'quantity'),
            reason: value(form, 'reason'),
          })
        )
          close();
      }}
    >
      <FormError />
      <RequestIdentity request={request} snapshot={snapshot} />
      <p className="text-sm">
        {beneficiaryNames(request, snapshot)} · {request.quantity - request.allocated}{' '}
        requested tickets remaining · {game?.availableTickets ?? 0} tickets
        available. Private inventory may be assigned by a coordinator.
      </p>
      <Field label="Tickets to allocate" required>
        <TextInput
          name="quantity"
          type="number"
          min={1}
          max={Math.min(
            request.quantity - request.allocated,
            game?.availableTickets ?? 0,
          )}
          defaultValue={Math.min(
            request.quantity - request.allocated,
            game?.availableTickets ?? 0,
          )}
          required
        />
      </Field>
      <Field label="Decision / override reason" required>
        <TextArea
          name="reason"
          required
          rows={3}
          maxLength={1000}
          placeholder="Record why this allocation is appropriate, including any score override."
        />
      </Field>
      <p className="text-sm text-slate-600">
        {snapshot.mode === 'dataverse' ? 'This saves the allocation in Dataverse. Transfer in the provider app remains manual.' : 'This records a local allocation only. Transfer in the provider app remains manual.'}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !game?.availableTickets}>
          {snapshot.mode === 'dataverse' ? 'Confirm allocation' : 'Confirm local allocation'}
        </Button>
      </div>
    </form>
  );
}
export function RequestsPanel() {
  const { snapshot, provider, persona, run, busy } = useReview(),
    admin = snapshot.persona.role === 'coordinator';
  const [gameId, setGameId] = useState(''),
    [selected, setSelected] = useState<InterestView | null>(null);
  const requests = snapshot.requests.filter(
    (r) => !gameId || r.gameId === gameId,
  );
  return (
    <Panel
      title={admin ? 'Review interest' : 'My interest'}
      description={
        admin
          ? 'Scores explain advisory factors. Allocate or waitlist deliberately; no recommendation changes inventory.'
          : 'Only your requests appear here. Other people’s identities, rationale and attendance are private.'
      }
    >
      {admin && (
        <Field label="Filter inventory">
          <Select value={gameId} onChange={(e) => setGameId(e.target.value)}>
            <option value="">All inventory, including private</option>
            {snapshot.catalog.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {!requests.length && (
        <Empty>
          No interest recorded for this view. Choose an inventory item to
          express interest.
        </Empty>
      )}
      <div className="space-y-4">
        {requests.map((r) => {
          const game = snapshot.catalog.find((g) => g.id === r.gameId),
            score = admin
              ? provider
                  .rank(persona, r.gameId)
                  .ranked.find((s) => s.requestId === r.id)
              : undefined;
          return (
            <article
              key={r.id}
              className="rounded-xl border border-slate-200 p-4 space-y-3"
              aria-label={`Interest ${beneficiaryNames(r, snapshot)}`}
            >
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <h3 className="font-semibold">
                    {game?.title ?? 'Unreleased or historical inventory'}
                  </h3>
                  {game && (
                    <p className="text-sm text-slate-500">
                      {dateTime(game.gameDate)}
                    </p>
                  )}
                </div>
                <Badge>{r.status.replaceAll('_', ' ')}</Badge>
              </div>
              <RequestIdentity request={r} snapshot={snapshot} />
              <p className="text-sm">
                Beneficiaries: {beneficiaryNames(r, snapshot)} ·{' '}
                {r.purpose === 'employee'
                  ? 'Employee / self'
                  : 'Customer / prospect'}{' '}
                ·{' '}
                <strong>
                  {r.quantity} requested / {r.allocated} allocated
                </strong>
              </p>
              <p className="text-sm whitespace-pre-wrap">{r.rationale}</p>
              {r.opportunity && (
                <p className="text-sm text-slate-600">
                  Opportunity / value context: {r.opportunity}
                </p>
              )}
              {admin && (
                <p className="text-xs text-slate-600">
                  Coordinator reliability flag: {r.confirmedNoShows || 0}{' '}
                  confirmed no-show ticket outcomes. Unknown outcomes excluded.
                  Review evidence and history before deciding.
                </p>
              )}
              {score && (
                <details className="rounded-lg bg-slate-50 p-3 text-sm">
                  <summary className="cursor-pointer font-medium">
                    Advisory score {score.finalScore.toFixed(2)} · rank{' '}
                    {score.rank} — human discretion
                  </summary>
                  <ul className="mt-3 space-y-2">
                    {score.breakdown
                      .filter((f) => f.weight > 0)
                      .map((f) => (
                        <li key={f.factor}>
                          <strong>{f.label}</strong> ({f.weight} ×{' '}
                          {f.normalizedValue.toFixed(2)}): {f.explanation}
                        </li>
                      ))}
                  </ul>
                  <p className="mt-3 text-xs">
                    Demonstration values are configurable, not settled business
                    policy. No automatic award, exclusion or employment
                    decision.
                  </p>
                </details>
              )}
              {admin && r.allocated < r.quantity && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => setSelected(r)}
                    disabled={busy}
                  >
                    Allocate / override
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => run({ type: 'waitlist', requestId: r.id })}
                    disabled={
                      busy || r.allocated > 0 || r.status === 'waitlisted'
                    }
                  >
                    Waitlist
                  </Button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Coordinator allocation"
        description="Human decision with a recorded reason."
      >
        {selected && (
          <AllocationForm request={selected} close={() => setSelected(null)} />
        )}
      </Modal>
    </Panel>
  );
}
function AttendanceForm({ allocation }: { allocation: Allocation }) {
  const { snapshot, run, busy } = useReview();
  const game = snapshot.catalog.find(g => g.id === allocation.gameId);
  const open = !!game && !!snapshot.serverNow && attendanceIsOpen(game.gameDate, snapshot.serverNow);
  const [outcome, setOutcome] = useState(allocation.outcome);
  const [evidence, setEvidence] = useState(allocation.evidence);
  const requiresEvidence = outcome !== 'unknown';
  return <form className="space-y-3 rounded-lg bg-slate-50 p-3" onSubmit={e => {
    e.preventDefault();
    if (!open || requiresEvidence && !evidence.trim()) return;
    void run({ type: 'attendance', assignmentId: allocation.id, outcome, evidence: evidence.trim() });
  }}>
    <h4 className="font-medium text-sm">Attendance: {allocation.outcome.replaceAll('_', ' ')}</h4>
    {!open && <p role="status" className="text-sm text-slate-600">{game ? `Attendance opens on ${attendanceDay(game.gameDate)} (Pacific Time).` : 'Event details are unavailable. Refresh before recording attendance.'}</p>}
    <Field label="Attendance outcome"><Select name="outcome" disabled={!open || busy} value={outcome} onChange={e => setOutcome(e.target.value as Allocation['outcome'])}>
      <option value="unknown">Unknown — no confirmation</option><option value="attended">Attended — confirmed</option><option value="no_show">No-show — confirmed</option>
    </Select></Field>
    <Field label="Evidence / confirmation note" required={requiresEvidence} hint={requiresEvidence ? 'Required to confirm attendance or a no-show.' : 'Optional while attendance is unknown.'}>
      <TextInput name="evidence" disabled={!open || busy} value={evidence} onChange={e => setEvidence(e.target.value)} required={requiresEvidence} maxLength={1000} />
    </Field>
    <Button type="submit" size="sm" variant="secondary" disabled={busy || !open || requiresEvidence && !evidence.trim()}>Save attendance</Button>
    <p className="text-xs text-slate-500">Available from the event day in Pacific Time. Without confirmation, keep Unknown.</p>
  </form>;
}

export function FollowthroughPanel({ assignmentId }: { assignmentId?: string } = {}) {
  const { snapshot, run, busy } = useReview(),
    [gameId, setGameId] = useState('');
  const allocations = (snapshot.allocations ?? []).filter(
    (a) => (!assignmentId || a.id === assignmentId) && (!gameId || a.gameId === gameId),
  );
  return (
    <Panel
      title="Manual transfer & attendance"
      description="Record the provider-app step separately from attendance. Confirmed outcomes require a note."
    >
      {!assignmentId && <Field label="Filter allocations by event">
        <Select value={gameId} onChange={(e) => setGameId(e.target.value)}>
          <option value="">All events and seasons</option>
          {snapshot.catalog.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </Select>
      </Field>}
      {!allocations.length && (
        <Empty>
          No allocations yet. Review interest and make a coordinator allocation
          first.
        </Empty>
      )}
      <div className="space-y-4">
        {allocations.map((a) => {
          const game = snapshot.catalog.find((g) => g.id === a.gameId),
            contact = snapshot.contacts?.find((c) => c.id === a.contactId);
          return (
            <article
              key={a.id}
              className="rounded-xl border border-slate-200 p-4 space-y-4"
              aria-label={`Allocation ${contact?.name} ${game?.title}`}
            >
              <div>
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-semibold">
                    {game?.title} · {personName(contact?.name ?? '')}
                  </h3>
                  <Badge>
                    {a.status === 'transferred'
                      ? 'Manual transfer recorded'
                      : a.status}
                  </Badge>
                </div>
                {game && (
                  <p className="text-sm text-slate-500">
                    {dateTime(game.gameDate)} ·{' '}
                    {game.seasonLabel ?? 'Dated event'}
                  </p>
                )}
                <p className="text-sm">
                  {contact?.email || 'No email'} ·{' '}
                  {contact?.phone || 'No phone recorded'}
                </p>
                <p className="text-xs text-slate-500 break-all">
                  {snapshot.mode === 'dataverse' ? 'Dataverse ticket ID' : 'Local ticket ID'}: {a.seatId}
                </p>
                <p className="text-sm mt-2">Decision: {a.decision}</p>
              </div>
              {a.status !== 'cancelled' && (
                <div className="grid gap-5 lg:grid-cols-2">
                  <form
                    className="space-y-3 rounded-lg bg-slate-50 p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void run({
                        type: 'manualTransfer',
                        assignmentId: a.id,
                        confirmed: f.has('confirmed'),
                        reference: value(f, 'reference'),
                      });
                    }}
                  >
                    <h4 className="font-medium text-sm">
                      Manual provider transfer
                    </h4>
                    <Field label="Manual reference / note" required>
                      <TextInput
                        name="reference"
                        required
                        maxLength={200}
                        defaultValue={a.transferReference}
                      />
                    </Field>
                    <label className="text-sm flex gap-2 items-start">
                      <input
                        type="checkbox"
                        name="confirmed"
                        required
                        className="mt-1"
                      />
                      I completed the transfer manually in the provider app.
                    </label>
                    <Button
                      type="submit"
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                    >
                      Record manual transfer
                    </Button>
                    <p className="text-xs text-slate-500">
                      {snapshot.mode === 'dataverse' ? 'Confirmation saved in Dataverse; this app never delivers tickets.' : 'Local record only; this app never delivers tickets.'}
                    </p>
                  </form>
                  <AttendanceForm key={`${a.id}:${a.outcome}:${a.evidence}`} allocation={a} />
                </div>
              )}
              {a.status !== 'cancelled' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run({ type: 'cancelAllocation', assignmentId: a.id })
                  }
                >
                  {snapshot.mode === 'dataverse' ? 'Cancel allocation' : 'Cancel local allocation'}
                </Button>
              )}
            </article>
          );
        })}
      </div>
    </Panel>
  );
}
