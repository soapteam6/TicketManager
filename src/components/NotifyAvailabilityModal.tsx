import { useEffect, useState } from 'react';
import { getAvailabilitySummary, broadcastAvailability } from '../services/notificationsService';
import { NOTIFY_AUDIENCE, type NotifyAudience } from '../domain/enums';
import { Modal } from './Modal';
import { Button } from './Button';
import { Field, TextArea } from './Field';

const AUDIENCE_LABEL: Record<NotifyAudience, string> = {
  everyone: 'Everyone',
  sales_team: 'Sales team',
};

// Broadcast a ticket-availability message to an audience. Mock-up: recorded via the 'notification'
// integration adapter, no real delivery. The message is seeded from a live availability summary.
export default function NotifyAvailabilityModal({ onClose }: { onClose: () => void }) {
  const [audience, setAudience] = useState<NotifyAudience>('everyone');
  const [message, setMessage] = useState('');
  const [edited, setEdited] = useState(false);
  const [summary, setSummary] = useState<{ availableSeats: number; gamesWithAvailability: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    getAvailabilitySummary().then((s) => {
      setSummary({ availableSeats: s.availableSeats, gamesWithAvailability: s.gamesWithAvailability });
      setMessage((prev) => (edited ? prev : s.message));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send() {
    setBusy(true);
    try {
      await broadcastAvailability(audience, message);
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Send availability"
      description="Broadcast a ticket-availability message. Mock-up — recorded to the integration log, not delivered."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {sent ? 'Close' : 'Cancel'}
          </Button>
          {!sent && (
            <Button loading={busy} disabled={!message.trim()} onClick={send}>
              Send to {AUDIENCE_LABEL[audience]}
            </Button>
          )}
        </>
      }
    >
      {sent ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
          Availability sent to {AUDIENCE_LABEL[audience]}. (Recorded to the integration log — no message was actually delivered.)
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Audience">
            <div className="flex flex-wrap gap-2">
              {NOTIFY_AUDIENCE.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAudience(a)}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                    audience === a ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-brand-400'
                  }`}
                >
                  {AUDIENCE_LABEL[a]}
                </button>
              ))}
            </div>
          </Field>

          {summary && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {summary.availableSeats} available seat{summary.availableSeats === 1 ? '' : 's'} across {summary.gamesWithAvailability} upcoming game
              {summary.gamesWithAvailability === 1 ? '' : 's'}.
            </div>
          )}

          <Field label="Message">
            <TextArea
              rows={5}
              value={message}
              onChange={(e) => {
                setEdited(true);
                setMessage(e.target.value);
              }}
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}
