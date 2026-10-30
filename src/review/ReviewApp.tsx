import { useEffect, useState, useSyncExternalStore } from 'react';
import { ReviewContext } from './context';
import type { PersonaKey, ReviewCommand, ReviewProvider } from './types';
import { SaveErrorNotice } from './SaveErrorNotice';
import { createErrorReport, type ErrorReport } from './errorReport';
import { DesignWorkspace } from './designs/DesignWorkspace';
import './designs/workspace.css';
import { withSeasonActivity } from './seasonActivity';
import { withEventActivity } from './eventActivity';

export function ReviewApp({ provider, onRefresh }: {
  provider: ReviewProvider;
  onRefresh?: () => Promise<void>;
}) {
  const [persona, setPersona] = useState<PersonaKey>('coordinator');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorReport | null>(null);
  const [errorTitle, setErrorTitle] = useState('Change not saved');
  useSyncExternalStore(provider.subscribe, provider.revision, provider.revision);
  const [, tick] = useState(0);
  const live = provider.mode === 'dataverse';
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => tick(n => n + 1), 1000);
    const resume = () => { if (document.visibilityState === 'visible') tick(n => n + 1); };
    document.addEventListener('visibilitychange', resume);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', resume); };
  }, [live]);
  const snapshot = withSeasonActivity(withEventActivity(provider.snapshot(persona)));
  async function refresh(): Promise<boolean> {
    if (!live) { window.location.reload(); return true; }
    setBusy(true); setError(null);
    try { await onRefresh?.(); return true; }
    catch (err) { setErrorTitle('Refresh failed'); setError(createErrorReport(err, 'Refresh workspace')); return false; }
    finally { setBusy(false); }
  }
  async function run(input: ReviewCommand | (() => ReviewCommand)) {
    setBusy(true);
    setError(null);
    setErrorTitle('Change not saved');
    let action = 'Save change';
    try {
      const command = typeof input === 'function' ? input() : input;
      action = `Save change: ${command.type}`;
      if (command.type === 'attendance') setErrorTitle('Attendance not saved');
      await provider.execute(
        persona,
        command,
      );
      return true;
    } catch (err) {
      setError(createErrorReport(err, action));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return <ReviewContext value={{ provider, snapshot, persona, busy, error: error?.message ?? '', run }}>
    {error && <SaveErrorNotice title={errorTitle} message={error.message} details={error.details} onDismiss={() => setError(null)} />}
    <DesignWorkspace onRefresh={refresh} onPersona={next => {
      setPersona(next); setError(null);
    }} />
  </ReviewContext>;
}
