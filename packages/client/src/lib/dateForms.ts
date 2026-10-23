import { calendarDateSchema, utcDateTimeInputToIso } from '@ais/shared';

export function utcDateTimeFromForm(form: HTMLFormElement, name: string): string {
  try {
    return utcDateTimeInputToIso(new FormData(form).get(name));
  } catch (error) {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement) field.focus();
    throw error;
  }
}

export function calendarDateFromForm(form: HTMLFormElement, name: string): string {
  const result = calendarDateSchema.safeParse(new FormData(form).get(name));
  if (result.success) return result.data;
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement) field.focus();
  throw new Error('Enter a complete, valid calendar date');
}
