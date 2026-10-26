import { useEffect, useState } from 'react';
import { MicrosoftDataverseService } from '../generated/services/MicrosoftDataverseService';
import { DataverseReviewProvider, type PlatformResponse, type PlatformTransport } from './platformProvider';
import { ReviewApp } from './ReviewApp';
import { Button } from './ui';
import { reviewErrorMessage } from './errorMessage';
import { createSnapshotLoader, workspaceLoadMessage } from './workspaceLoading';
import logoUrl from '../assets/ais-logo.webp';

const transport: PlatformTransport = async (payload) => {
  const response = await MicrosoftDataverseService.PerformUnboundActionWithOrganization(
    'https://org5c824bd0.crm.dynamics.com', 'cr9cd_TicketReview', { Payload: JSON.stringify(payload) },
  );
  if (!response.success || typeof response.data?.Result !== 'string') {
    throw new Error(response.error ? reviewErrorMessage(response.error) : 'Dataverse review API is unavailable. Verify the AIS Development QA setup and your Ticket Manager role.');
  }
  return JSON.parse(response.data.Result) as PlatformResponse;
};
const loadSnapshot = createSnapshotLoader(transport);

export function PlatformReview() {
  const [provider, setProvider] = useState<DataverseReviewProvider | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    loadSnapshot().then(initial => {
      if (active) { setProvider(new DataverseReviewProvider(transport, initial)); setError(''); }
    }).catch(err => { if (active) setError(workspaceLoadMessage(err)); });
    return () => { active = false; };
  }, [attempt]);
  if (provider) return <ReviewApp provider={provider} onRefresh={() => provider.reload()} />;
  return <div className="work-shell work-shell--desk">
    <header className="work-app-header"><div className="work-brand"><img src={logoUrl} alt="AIS" /><span className="work-brand-divider" /><div><strong>Allocation desk</strong><span>Ticket management</span></div></div></header>
    <main className="work-connection-state" aria-busy={!error}>
      {error ? <><h1>Unable to load the workspace</h1><p role="alert">{error}</p><Button onClick={() => { setError(''); setAttempt(n => n + 1); }}>Try again</Button></> : <><span className="work-loading-indicator" aria-hidden="true" /><p role="status">Loading your workspace…</p></>}
    </main>
  </div>;
}
