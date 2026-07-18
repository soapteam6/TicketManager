import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { NOTIFY_AUDIENCE } from '@ais/shared';
import { api } from '@/lib/api';
import { Modal } from './Modal';
import { Button } from './Button';
import { Field, TextArea } from './Field';
import { ErrorNote } from './QueryState';

const AUDIENCE_LABELS: Record<(typeof NOTIFY_AUDIENCE)[number], string> = {
  everyone: 'Everyone',
  sales_team: 'Sales team',
};

interface Preview {
  availableSeats: number;
  gamesWithAvailability: number;
  message: string;
}

// Compose and send an availability broadcast to Everyone or the Sales team.
export function NotifyAvailabilityModal({ onClose }: { onClose: () => void }) {
  const [audience, setAudience] = useState<(typeof NOTIFY_AUDIENCE)[number]>('everyone');
  const [message, setMessage] = useState('');
  const [edited, setEdited] = useState(false);

  const preview = useQuery({
    queryKey: ['notifications', 'availability'],
    queryFn: async () => (await api.get<Preview>('/notifications/availability')).data,
  });

  // Seed the composer with the suggested message once it loads (unless the user has edited it).
  useEffect(() => {
    if (preview.data && !edited) setMessage(preview.data.message);
  }, [preview.data, edited]);

  const send = useMutation({
    mutationFn: async () => (await api.post('/notifications/availability', { audience, message })).data,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Send availability update"
      description="Let people know how many tickets are available."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{send.isSuccess ? 'Close' : 'Cancel'}</Button>
          {!send.isSuccess && (
            <Button loading={send.isPending} disabled={!message.trim()} onClick={() => send.mutate()}>
              Send to {AUDIENCE_LABELS[audience]}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {preview.data && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <span className="font-semibold text-slate-800">{preview.data.availableSeats}</span> tickets available across{' '}
            <span className="font-semibold text-slate-800">{preview.data.gamesWithAvailability}</span> upcoming game(s).
          </div>
        )}

        <Field label="Recipients">
          <div className="flex gap-2">
            {NOTIFY_AUDIENCE.map((a) => {
              const on = audience === a;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAudience(a)}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                    on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-brand-400'
                  }`}
                >
                  {AUDIENCE_LABELS[a]}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Message">
          <TextArea
            rows={4}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setEdited(true);
            }}
          />
        </Field>

        {send.isSuccess && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Sent to {AUDIENCE_LABELS[audience]}.
          </div>
        )}
        <ErrorNote error={send.error} />
      </div>
    </Modal>
  );
}
