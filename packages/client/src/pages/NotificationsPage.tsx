import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Game } from '@/lib/types';
import { pickArray } from '@/lib/unwrap';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Field, TextInput, TextArea, Select } from '@/components/Field';

// ---- Mock-up domain model (nothing is delivered yet) -------------------------------------------

type NotifType = 'reminder' | 'announcement' | 'game_link' | 'availability';
type Audience = 'everyone' | 'sales_team' | 'employees' | 'holders';
type Channel = 'email' | 'sms' | 'in_app';
type Status = 'sent' | 'scheduled' | 'draft';

const TYPES: { key: NotifType; label: string; tone: BadgeTone; subject: string; body: string }[] = [
  {
    key: 'reminder',
    label: 'Reminder',
    tone: 'amber',
    subject: 'Reminder: your game is coming up',
    body: "Don't forget — your game is almost here. Doors open 90 minutes before start. See you there!",
  },
  {
    key: 'announcement',
    label: 'Announcement',
    tone: 'violet',
    subject: 'An update from AIS Ticket Concierge',
    body: 'We have some news to share with you. Read on for the details…',
  },
  {
    key: 'game_link',
    label: 'Game link',
    tone: 'blue',
    subject: 'Your tickets & game details',
    body: 'Here are the details for your upcoming game. Use the link below to view everything:',
  },
  {
    key: 'availability',
    label: 'Availability',
    tone: 'green',
    subject: 'Tickets available for upcoming games',
    body: "We have open seats for upcoming games. Reply to claim yours before they're gone!",
  },
];

const AUDIENCES: { key: Audience; label: string; reach: number }[] = [
  { key: 'everyone', label: 'Everyone', reach: 248 },
  { key: 'sales_team', label: 'Sales team', reach: 12 },
  { key: 'employees', label: 'Employees', reach: 240 },
  { key: 'holders', label: 'Season-ticket holders', reach: 36 },
];

const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
  { key: 'in_app', label: 'In-app' },
];

const TEMPLATES: { name: string; type: NotifType; subject: string; body: string }[] = [
  { name: 'Game-day reminder', type: 'reminder', subject: 'Tonight: game day!', body: 'Your game is tonight — arrive early, doors open 90 minutes before start. Enjoy the game!' },
  { name: 'New tickets available', type: 'availability', subject: 'New tickets just opened up', body: 'Fresh inventory is available for upcoming games. First come, first served — reply to claim seats.' },
  { name: 'Playoff lottery', type: 'announcement', subject: 'Playoff ticket lottery opens Friday', body: 'Entries for the playoff ticket lottery open this Friday. Watch for the sign-up link.' },
  { name: 'Your seats + link', type: 'game_link', subject: 'Here are your seats', body: 'Thanks for your request — your seats are confirmed. View the game details at the link below.' },
];

const typeMeta = (t: NotifType) => TYPES.find((x) => x.key === t)!;
const audienceMeta = (a: Audience) => AUDIENCES.find((x) => x.key === a)!;
const channelLabel = (c: Channel) => CHANNELS.find((x) => x.key === c)!.label;
const STATUS_TONE: Record<Status, BadgeTone> = { sent: 'green', scheduled: 'amber', draft: 'slate' };

interface NotifRow {
  id: number;
  type: NotifType;
  subject: string;
  audience: Audience;
  channel: Channel;
  status: Status;
  when: string;
}

const SEED: NotifRow[] = [
  { id: 4, type: 'reminder', subject: 'Tonight: Knights vs Avalanche', audience: 'holders', channel: 'email', status: 'sent', when: '2h ago' },
  { id: 3, type: 'availability', subject: 'New tickets available this week', audience: 'everyone', channel: 'email', status: 'sent', when: 'Yesterday' },
  { id: 2, type: 'announcement', subject: 'Playoff ticket lottery opens Friday', audience: 'employees', channel: 'in_app', status: 'scheduled', when: 'in 2 days' },
  { id: 1, type: 'game_link', subject: 'Your seats: vs San Jose Sharks', audience: 'sales_team', channel: 'email', status: 'sent', when: '3d ago' },
];

// ------------------------------------------------------------------------------------------------

export function NotificationsPage() {
  const [type, setType] = useState<NotifType>('reminder');
  const [audience, setAudience] = useState<Audience>('everyone');
  const [channel, setChannel] = useState<Channel>('email');
  const [subject, setSubject] = useState(typeMeta('reminder').subject);
  const [body, setBody] = useState(typeMeta('reminder').body);
  const [gameId, setGameId] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [rows, setRows] = useState<NotifRow[]>(SEED);
  const [flash, setFlash] = useState<string | null>(null);

  const games = useQuery({
    queryKey: ['games', 'select'],
    queryFn: async () => pickArray<Game>((await api.get('/games')).data, 'games'),
    staleTime: 60_000,
  });

  const reach = audienceMeta(audience).reach;

  function applyTemplate(t: { type: NotifType; subject: string; body: string }) {
    setType(t.type);
    setSubject(t.subject);
    setBody(t.body);
    setFlash(null);
  }

  function insertGameLink() {
    const g = games.data?.find((x) => String(x.id) === gameId);
    if (!g) return;
    const label = g.kind === 'event' ? g.title ?? g.opponent : `vs ${g.opponent}`;
    setBody((b) => `${b}\n\n🎟 ${label} — ${window.location.origin}/games/${g.id}`);
  }

  function send() {
    const next: NotifRow = {
      id: Math.max(0, ...rows.map((r) => r.id)) + 1,
      type,
      subject: subject.trim() || typeMeta(type).subject,
      audience,
      channel,
      status: scheduled ? 'scheduled' : 'sent',
      when: scheduled ? (scheduleAt ? scheduleAt.replace('T', ' ') : 'scheduled') : 'Just now',
    };
    setRows((r) => [next, ...r]);
    setFlash(
      scheduled
        ? `Scheduled for ${audienceMeta(audience).label} (~${reach} recipients) via ${channelLabel(channel)}.`
        : `Sent to ${audienceMeta(audience).label} (~${reach} recipients) via ${channelLabel(channel)}.`
    );
  }

  const columns: Column<NotifRow>[] = useMemo(
    () => [
      { key: 'type', header: 'Type', render: (r) => <Badge tone={typeMeta(r.type).tone}>{typeMeta(r.type).label}</Badge> },
      { key: 'subject', header: 'Subject', render: (r) => <span className="font-medium text-slate-800">{r.subject}</span> },
      { key: 'aud', header: 'Audience', render: (r) => audienceMeta(r.audience).label },
      { key: 'ch', header: 'Channel', render: (r) => channelLabel(r.channel) },
      { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Badge> },
      { key: 'when', header: 'When', align: 'right', render: (r) => <span className="text-slate-500">{r.when}</span> },
    ],
    []
  );

  const seg = (on: boolean) =>
    `rounded-md border px-3 py-2 text-sm font-medium transition ${
      on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-brand-400'
    }`;

  return (
    <div>
      <PageHeader title="Notification Manager" subtitle="Send reminders, announcements, and game links to your audiences." />

      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Mock-up preview — composing and scheduling work here, but messages aren't delivered yet.
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Composer */}
        <div className="space-y-6 xl:col-span-2">
          <div className="card p-5">
            <h3 className="mb-4 text-sm font-semibold text-slate-800">Compose</h3>

            <div className="space-y-4">
              <Field label="Type">
                <div className="flex flex-wrap gap-2">
                  {TYPES.map((t) => (
                    <button key={t.key} type="button" className={seg(type === t.key)} onClick={() => applyTemplate({ type: t.key, subject: t.subject, body: t.body })}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Recipients">
                  <div className="flex flex-wrap gap-2">
                    {AUDIENCES.map((a) => (
                      <button key={a.key} type="button" className={seg(audience === a.key)} onClick={() => setAudience(a.key)}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Channel">
                  <div className="flex flex-wrap gap-2">
                    {CHANNELS.map((c) => (
                      <button key={c.key} type="button" className={seg(channel === c.key)} onClick={() => setChannel(c.key)}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

              <Field label="Subject">
                <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" />
              </Field>

              <Field label="Message">
                <TextArea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
              </Field>

              <Field label="Link a game (optional)" hint="Adds a game link to the message">
                <div className="flex gap-2">
                  <Select value={gameId} onChange={(e) => setGameId(e.target.value)} className="flex-1">
                    <option value="">Select a game…</option>
                    {games.data?.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.kind === 'event' ? g.title ?? g.opponent : `vs ${g.opponent}`}
                      </option>
                    ))}
                  </Select>
                  <Button variant="secondary" disabled={!gameId} onClick={insertGameLink}>Insert link</Button>
                </div>
              </Field>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                Schedule for later
              </label>
              {scheduled && (
                <Field label="Send at">
                  <TextInput type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
                </Field>
              )}
            </div>

            <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-500">
                Will {scheduled ? 'schedule' : 'send'} to <span className="font-semibold text-slate-800">{audienceMeta(audience).label}</span>{' '}
                (~{reach} recipients) via {channelLabel(channel)}.
              </div>
              <Button disabled={!subject.trim() || !body.trim()} onClick={send}>
                {scheduled ? 'Schedule' : 'Send now'}
              </Button>
            </div>
            {flash && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{flash}</div>
            )}
          </div>
        </div>

        {/* Side: reach + templates */}
        <div className="space-y-6">
          <div className="card p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Audience reach</h3>
            <div className="space-y-2">
              {AUDIENCES.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setAudience(a.key)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition hover:border-brand-400 ${
                    audience === a.key ? 'border-brand-400 bg-brand-50/50' : 'border-slate-200'
                  }`}
                >
                  <span className="font-medium text-slate-700">{a.label}</span>
                  <span className="tabular-nums text-slate-500">{a.reach}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="mb-1 text-sm font-semibold text-slate-800">Templates</h3>
            <p className="mb-3 text-xs text-slate-400">Click to load into the composer.</p>
            <div className="space-y-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm transition hover:border-brand-400 hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={typeMeta(t.type).tone}>{typeMeta(t.type).label}</Badge>
                    <span className="font-medium text-slate-800">{t.name}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-400">{t.subject}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="mt-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Recent notifications</h3>
        <DataTable columns={columns} rows={rows} keyFn={(r) => r.id} emptyTitle="No notifications yet" />
      </div>
    </div>
  );
}
