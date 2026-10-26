import { useState } from 'react';
import { useReview } from './context';
import { FACTOR_LABELS } from '../domain/constants';
import type { FactorKey } from '../domain/enums';
import type { ScoreSettings } from './types';
import {
  Badge,
  Button,
  Empty,
  Field,
  Panel,
  Select,
  TextArea,
  TextInput,
} from './ui';
import { dateTime, number, value } from './form';
const factors: FactorKey[] = [
  'strategicValue',
  'salesOpportunity',
  'fairness',
  'reliability',
];
export function ScoringPanel() {
  const { snapshot, run, busy } = useReview(),
    settings = snapshot.scoring;
  if (!settings) return null;
  return (
    <Panel
      title="Advisory scoring defaults"
      description="These demonstration values are not settled business policy. Coordinators read the factors and record a decision or override reason. Scores never allocate tickets or change employment eligibility."
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const weights = { ...settings.weights };
          for (const factor of factors) weights[factor] = number(f, factor);
          const next: ScoreSettings = {
            weights,
            category: {
              customer: number(f, 'customer'),
              prospect: number(f, 'prospect'),
              employee: number(f, 'employee'),
            },
          };
          void run({ type: 'scoring', settings: next });
        }}
      >
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 font-medium">
            Factor weights (0–1, additive; no automatic normalization)
          </legend>
          {factors.map((factor) => (
            <Field key={factor} label={FACTOR_LABELS[factor]}>
              <TextInput
                type="number"
                name={factor}
                min={0}
                max={1}
                step={0.01}
                defaultValue={settings.weights[factor]}
                required
              />
            </Field>
          ))}
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-3 font-medium">
            Transparent category values (0–1)
          </legend>
          {(['customer', 'prospect', 'employee'] as const).map((category) => (
            <Field key={category} label={category}>
              <TextInput
                type="number"
                name={category}
                min={0}
                max={1}
                step={0.01}
                defaultValue={settings.category[category]}
                required
              />
            </Field>
          ))}
        </fieldset>
        <ul className="list-disc pl-5 space-y-2 text-sm text-slate-600">
          <li>
            Category distinguishes customer, prospect and employee. Customer
            tier differences do not affect this factor.
          </li>
          <li>
            Rationale/opportunity records whether context is provided; a person
            evaluates its quality and any value/MRR context.
          </li>
          <li>
            Fairness considers other allocation requests for the
            contact/business in the same sports season. Earlier seasons do not
            reduce this factor. Ad hoc events have no season penalty.
          </li>
          <li>
            Reliability uses confirmed attended and no-show outcomes only.
            Unknown outcomes are neutral. It is a coordinator flag, never
            automatic exclusion.
          </li>
          <li>
            Lead time, premium demand, employee/customer balance and duplicate
            attendance weighting are disabled in this review.
          </li>
        </ul>
        <Button type="submit" disabled={busy}>
          Save demo scoring defaults
        </Button>
      </form>
    </Panel>
  );
}
export function MessagesPanel() {
  const { snapshot, provider, persona, run, busy } = useReview(),
    [body, setBody] = useState(() => provider.availability(persona));
  const template = snapshot.followup;
  return (
    <div className="space-y-5">
      <Panel
        title="Availability announcement preview"
        description={snapshot.mode === 'dataverse' ? 'Availability previews are saved in the QA workspace. No email or SMS is sent.' : 'Choose when to announce released inventory. Saving visibility never announces it. Only a local mock outbox is supported; no email or SMS delivery.'}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const audience = value(new FormData(e.currentTarget), 'audience');
            if (audience === 'sales_team' || audience === 'everyone')
              void run({ type: 'availability', body, audience });
          }}
        >
          <Field label="Mock audience">
            <Select name="audience">
              <option value="sales_team">Synthetic sales team</option>
              <option value="everyone">All synthetic employees</option>
            </Select>
          </Field>
          <Field label="Availability message preview">
            <TextArea
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              maxLength={2000}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setBody(provider.availability(persona))}
            >
              Refresh availability summary
            </Button>
            <Button type="submit" disabled={busy}>
              Add availability to mock outbox
            </Button>
          </div>
        </form>
      </Panel>
      {template && (
        <Panel
          title="Optional post-event follow-up"
          description="Disabled by default. Wording and photo expectations require human acceptance. Saving a template creates no scheduler, subscription or message."
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run({
                type: 'followupTemplate',
                template: {
                  enabled: f.has('enabled'),
                  subject: value(f, 'subject'),
                  body: value(f, 'body'),
                },
              });
            }}
          >
            <label className="flex gap-2 text-sm items-start">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={template.enabled}
                className="mt-1"
              />
              Enable optional local follow-up preview (no delivery)
            </label>
            <Field label="Follow-up subject">
              <TextInput
                name="subject"
                required
                maxLength={200}
                defaultValue={template.subject}
              />
            </Field>
            <Field label="Follow-up template">
              <TextArea
                name="body"
                required
                maxLength={2000}
                rows={4}
                defaultValue={template.body}
              />
            </Field>
            <p className="text-xs text-slate-500">
              A photo is optional. There is no upload flow, and silence leaves
              attendance unknown. No automatic game-day reminders.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="secondary" disabled={busy}>
                Save follow-up template
              </Button>
              <Button
                type="button"
                disabled={busy || !template.enabled}
                onClick={() => run({ type: 'followupOutbox' })}
              >
                Add saved follow-up to mock outbox
              </Button>
            </div>
          </form>
        </Panel>
      )}
      <Panel
        title="Local mock outbox"
        description="Preview records only. No messages were sent, scheduled or delivered."
      >
        {!snapshot.outbox?.length && (
          <Empty>
            The mock outbox is empty. Inventory releases and allocations never
            add messages automatically.
          </Empty>
        )}
        <div className="space-y-3">
          {snapshot.outbox?.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-slate-200 p-4 space-y-2"
            >
              <Badge>{item.kind} · mock only</Badge>
              <h3 className="font-semibold">{item.subject}</h3>
              <p className="text-xs text-slate-500">
                {item.audience} · {dateTime(item.createdAt)}
              </p>
              <p className="whitespace-pre-wrap text-sm">{item.body}</p>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
