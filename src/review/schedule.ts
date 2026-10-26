import { isCalendarDate, parseIsoTimestamp } from './dates';
import type { SchedulePreview } from './types';

// Deterministic, local CSV subset: quoted fields/doubled quotes, no embedded newlines.
export function previewScheduleCsv(csv: string): SchedulePreview {
  const rows: SchedulePreview['rows'] = [];
  const errors: string[] = [];
  const lines = csv
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'));
  for (const [index, line] of lines.entries()) {
    if (index === 0 && /^date,/i.test(line.trim())) continue;
    const cells: string[] = [];
    let cell = '',
      quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) {
        cells.push(cell.trim());
        cell = '';
      } else cell += ch;
    }
    cells.push(cell.trim());
    const [date = '', time = '', title = '', tickets = '', kind = 'game'] =
      cells;
    const at = `${date}T${time}:00Z`;
    if (
      quoted ||
      cells.length !== 5 ||
      !isCalendarDate(date) ||
      !/^\d{2}:\d{2}$/.test(time) ||
      parseIsoTimestamp(at) === null ||
      !title ||
      !/^\d+$/.test(tickets) ||
      Number(tickets) > 1000 ||
      !['game', 'event'].includes(kind)
    ) {
      errors.push(
        `Row ${index + 1}: use a real YYYY-MM-DD date, HH:mm UTC time, title, 0–1000 tickets, and game/event kind.`,
      );
      continue;
    }
    rows.push({
      gameDate: at,
      title,
      tickets: Number(tickets),
      kind: kind === 'event' ? 'event' : 'game',
    });
  }
  if (!rows.length && !errors.length)
    errors.push('Paste at least one synthetic schedule row.');
  return { rows, errors, timezone: 'UTC', published: false };
}
