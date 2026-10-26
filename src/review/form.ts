export const value = (form: FormData, key: string) =>
  String(form.get(key) ?? '');
export const number = (form: FormData, key: string) => Number(value(form, key));
export function dateTime(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(iso));
}
