import { describe, expect, it } from 'vitest';
import { reviewErrorMessage } from './errorMessage';

describe('Dataverse validation reasons', () => {
  it('explains write conflicts without exposing RowVersion internals', () => {
    const message = reviewErrorMessage(new Error('The version of the existing record does not match the RowVersion property provided.'));
    expect(message).toContain('Someone else updated the workspace');
    expect(message).not.toContain('RowVersion');
  });
  it('preserves an ordinary server validation error', () => {
    expect(reviewErrorMessage(new Error('Attendance cannot be confirmed before the event.')))
      .toBe('Attendance cannot be confirmed before the event.');
  });
  it('extracts a nested connector response instead of showing object text', () => {
    expect(reviewErrorMessage({ message: 'Connector request failed', response: { data: { error: { message: 'Confirm attendance only after the event.' } } } }))
      .toBe('Confirm attendance only after the event.');
  });
  it('extracts JSON response bodies', () => {
    expect(reviewErrorMessage({ body: JSON.stringify({ error: { message: 'Enter explicit no-show evidence.' } }) }))
      .toBe('Enter explicit no-show evidence.');
  });
  it('handles cyclic or empty SDK errors with a useful fallback', () => {
    const cyclic: Record<string, unknown> = {}; cyclic.innerError = cyclic;
    expect(reviewErrorMessage(cyclic)).toContain('could not be saved');
    expect(reviewErrorMessage({})).not.toContain('[object Object]');
  });
});
