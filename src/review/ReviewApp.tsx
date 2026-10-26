import { useState, useSyncExternalStore } from 'react';
import { ReviewContext } from './context';
import type { PersonaKey, ReviewCommand, ReviewProvider } from './types';
import { SaveErrorNotice } from './SaveErrorNotice';
import { reviewErrorMessage } from './errorMessage';
import { DesignWorkspace } from './designs/DesignWorkspace';
import './designs/workspace.css';

export function ReviewApp({ provider, onRefresh }: {
  provider: ReviewProvider;
  onRefresh?: () => Promise<void>;
}) {
  const [persona, setPersona] = useState<PersonaKey>('coordinator');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorTitle, setErrorTitle] = useState('Change not saved');
  useSyncExternalStore(provider.subscribe, provider.revision, provider.revision);
  const snapshot = provider.snapshot(persona);
  const live = provider.mode === 'dataverse';
  async function refresh(): Promise<boolean> {
    if (!live) { window.location.reload(); return true; }
    setBusy(true); setError('');
    try { await onRefresh?.(); return true; }
    catch (err) { setErrorTitle('Refresh failed'); setError(reviewErrorMessage(err)); return false; }
    finally { setBusy(false); }
  }
  async function run(input: ReviewCommand | (() => ReviewCommand)) {
    setBusy(true);
    setError('');
    setErrorTitle('Change not saved');
    try {
      const command = typeof input === 'function' ? input() : input;
      if (command.type === 'attendance') setErrorTitle('Attendance not saved');
      await provider.execute(
        persona,
        command,
      );
      return true;
    } catch (err) {
      setError(reviewErrorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return <ReviewContext value={{ provider, snapshot, persona, busy, error, run }}>
    {error && <SaveErrorNotice title={errorTitle} message={error} onDismiss={() => setError('')} />}
    <DesignWorkspace onRefresh={refresh} onPersona={next => {
      setPersona(next); setError('');
    }} />
  </ReviewContext>;
}
