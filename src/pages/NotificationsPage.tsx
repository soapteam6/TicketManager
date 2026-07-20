import { useEffect, useMemo, useState } from 'react';
import { Cr9cd_gamesService } from '../generated/services/Cr9cd_gamesService';
import type { Cr9cd_games } from '../generated/models/Cr9cd_gamesModel';
import { Cr9cd_notificationsService } from '../generated/services/Cr9cd_notificationsService';
import type { Cr9cd_notifications } from '../generated/models/Cr9cd_notificationsModel';
import { Cr9cd_notificationtemplatesService } from '../generated/services/Cr9cd_notificationtemplatesService';
import { Cr9cd_contact_beneficiariesService } from '../generated/services/Cr9cd_contact_beneficiariesService';
import {
  gameKindChoice,
  notificationTypeChoice,
  notificationChannelChoice,
  notificationAudienceChoice,
  notificationStatusChoice,
} from '../dataverse/choiceMaps';
import { bindRef } from '../dataverse/bind';
import { formatDateTime } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { PlaceholderFlag } from '../components/PlaceholderFlag';
import { DataTable, type Column } from '../components/DataTable';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Field, TextInput, TextArea, Select } from '../components/Field';

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

// `reach` here is a fallback/placeholder count. `done` audiences get a live headcount from
// Dataverse (see reachByKey); the rest keep the placeholder and are flagged with <PlaceholderFlag>.
const AUDIENCES: { key: Audience; label: string; reach: number; done: boolean; todo?: string }[] = [
  { key: 'everyone', label: 'Everyone', reach: 248, done: true },
  { key: 'sales_team', label: 'Sales team', reach: 12, done: false, todo: '“sales team” membership isn’t modeled on contacts yet' },
  { key: 'employees', label: 'Employees', reach: 240, done: false, todo: 'no real staff/employee list — the contact table only holds ticket beneficiaries' },
  { key: 'holders', label: 'Season-ticket holders', reach: 36, done: false, todo: 'there’s no season-ticket-holder flag on contacts yet' },
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

function gameLabel(g: Cr9cd_games): string {
  const kind = g.cr9cd_kind != null ? gameKindChoice.toValue(g.cr9cd_kind) : 'game';
  return kind === 'event' ? g.cr9cd_title ?? g.cr9cd_opponent ?? 'Event' : `vs ${g.cr9cd_opponent ?? ''}`;
}

// ------------------------------------------------------------------------------------------------

export default function NotificationsPage() {
  const [type, setType] = useState<NotifType>('reminder');
  const [audience, setAudience] = useState<Audience>('everyone');
  const [channel, setChannel] = useState<Channel>('email');
  const [subject, setSubject] = useState(typeMeta('reminder').subject);
  const [body, setBody] = useState(typeMeta('reminder').body);
  const [gameId, setGameId] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [rows, setRows] = useState<Cr9cd_notifications[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [games, setGames] = useState<Cr9cd_games[]>([]);
  const [templates, setTemplates] = useState<{ name: string; type: NotifType; subject: string; body: string }[]>(TEMPLATES);

  useEffect(() => {
    Cr9cd_gamesService.getAll({ orderBy: ['cr9cd_game_date desc'] }).then((result) => setGames(result.data ?? []));
  }, []);

  function loadRecent() {
    return Cr9cd_notificationsService.getAll({ orderBy: ['createdon desc'], top: 50 }).then((result) => setRows(result.data ?? []));
  }

  useEffect(() => {
    loadRecent();
  }, []);

  // Live headcount for the only real audience today (Everyone = all contacts). The rest keep
  // their static placeholder value and are flagged with <PlaceholderFlag>.
  const [reachByKey, setReachByKey] = useState<Record<Audience, number>>(() =>
    Object.fromEntries(AUDIENCES.map((a) => [a.key, a.reach])) as Record<Audience, number>
  );

  useEffect(() => {
    Cr9cd_contact_beneficiariesService.getAll({ select: ['cr9cd_contact_beneficiaryid'] }).then((all) => {
      setReachByKey((prev) => ({ ...prev, everyone: all.data?.length ?? 0 }));
    });
  }, []);

  useEffect(() => {
    Cr9cd_notificationtemplatesService.getAll({ orderBy: ['cr9cd_name asc'] }).then((result) => {
      const data = result.data ?? [];
      if (data.length > 0) {
        setTemplates(
          data.map((t) => ({
            name: t.cr9cd_name,
            type: t.cr9cd_type != null ? notificationTypeChoice.toValue(t.cr9cd_type) : 'reminder',
            subject: t.cr9cd_subject ?? '',
            body: t.cr9cd_body ?? '',
          }))
        );
      }
    });
  }, []);

  const reach = reachByKey[audience];

  function applyTemplate(t: { type: NotifType; subject: string; body: string }) {
    setType(t.type);
    setSubject(t.subject);
    setBody(t.body);
    setFlash(null);
  }

  function insertGameLink() {
    const g = games.find((x) => x.cr9cd_gameid === gameId);
    if (!g) return;
    setBody((b) => `${b}\n\n🎟 ${gameLabel(g)} — ${window.location.origin}/#/games/${g.cr9cd_gameid}`);
  }

  async function send() {
    setBusy(true);
    try {
      await Cr9cd_notificationsService.create({
        cr9cd_name: subject.trim() || typeMeta(type).subject,
        cr9cd_message: body,
        cr9cd_type: notificationTypeChoice.toCode(type),
        cr9cd_channel: notificationChannelChoice.toCode(channel),
        cr9cd_audience: notificationAudienceChoice.toCode(audience),
        cr9cd_status: notificationStatusChoice.toCode(scheduled ? 'scheduled' : 'sent'),
        cr9cd_recipient_count: reach,
        ...(scheduled && scheduleAt ? { cr9cd_scheduled_at: new Date(scheduleAt).toISOString() } : {}),
        ...(!scheduled ? { cr9cd_sent_at: new Date().toISOString() } : {}),
        ...(gameId ? { 'cr9cd_Game@odata.bind': bindRef('cr9cd_games', gameId) } : {}),
      } as Parameters<typeof Cr9cd_notificationsService.create>[0]);
      setFlash(
        scheduled
          ? `Scheduled for ${audienceMeta(audience).label} (~${reach} recipients) via ${channelLabel(channel)}.`
          : `Sent to ${audienceMeta(audience).label} (~${reach} recipients) via ${channelLabel(channel)}.`
      );
      await loadRecent();
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Cr9cd_notifications>[] = useMemo(
    () => [
      {
        key: 'type',
        header: 'Type',
        render: (r) => {
          if (r.cr9cd_type == null) return <span className="text-slate-400">—</span>;
          const meta = typeMeta(notificationTypeChoice.toValue(r.cr9cd_type));
          return <Badge tone={meta.tone}>{meta.label}</Badge>;
        },
      },
      { key: 'subject', header: 'Subject', render: (r) => <span className="font-medium text-slate-800">{r.cr9cd_name}</span> },
      {
        key: 'aud',
        header: 'Audience',
        render: (r) => (r.cr9cd_audience != null ? audienceMeta(notificationAudienceChoice.toValue(r.cr9cd_audience)).label : '—'),
      },
      {
        key: 'ch',
        header: 'Channel',
        render: (r) => (r.cr9cd_channel != null ? channelLabel(notificationChannelChoice.toValue(r.cr9cd_channel)) : '—'),
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => {
          if (r.cr9cd_status == null) return <span className="text-slate-400">—</span>;
          const s = notificationStatusChoice.toValue(r.cr9cd_status);
          return <Badge tone={STATUS_TONE[s]}>{s[0].toUpperCase() + s.slice(1)}</Badge>;
        },
      },
      {
        key: 'when',
        header: 'When',
        align: 'right',
        render: (r) => <span className="text-slate-500">{formatDateTime(r.cr9cd_sent_at ?? r.cr9cd_scheduled_at ?? r.createdon)}</span>,
      },
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
                    {games.map((g) => (
                      <option key={g.cr9cd_gameid} value={g.cr9cd_gameid}>
                        {gameLabel(g)}
                      </option>
                    ))}
                  </Select>
                  <Button variant="secondary" disabled={!gameId} onClick={insertGameLink}>
                    Insert link
                  </Button>
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
                (~{reach} recipients){!audienceMeta(audience).done && <PlaceholderFlag note={audienceMeta(audience).todo} className="mx-1 align-middle" />} via {channelLabel(channel)}.
              </div>
              <div className="flex items-center gap-2">
                <PlaceholderFlag note="messages are recorded here but not actually delivered yet" />
                <Button disabled={!subject.trim() || !body.trim() || busy} onClick={send}>
                  {scheduled ? 'Schedule' : 'Send now'}
                </Button>
              </div>
            </div>
            {flash && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{flash}</div>}
          </div>
        </div>

        {/* Side: reach + templates */}
        <div className="space-y-6">
          <div className="card p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Audience reach</h3>
            <div className="space-y-2">
              {AUDIENCES.filter((a) => a.key !== 'everyone').map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setAudience(a.key)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition hover:border-brand-400 ${
                    audience === a.key ? 'border-brand-400 bg-brand-50/50' : 'border-slate-200'
                  }`}
                >
                  <span className="font-medium text-slate-700">{a.label}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="tabular-nums text-slate-500">{reachByKey[a.key]}</span>
                    {!a.done && <PlaceholderFlag note={a.todo} />}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="mb-1 text-sm font-semibold text-slate-800">Templates</h3>
            <p className="mb-3 text-xs text-slate-400">Click to load into the composer.</p>
            <div className="space-y-2">
              {templates.map((t) => (
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
        <DataTable columns={columns} rows={rows} keyFn={(r) => r.cr9cd_notificationid} emptyTitle="No notifications yet" />
      </div>
    </div>
  );
}
