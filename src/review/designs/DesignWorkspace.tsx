import { useEffect, useState } from 'react';
import logoUrl from '../../assets/ais-logo.webp?inline';
import { useReview } from '../context';
import { PERSONAS } from '../fixtures';
import { personName } from '../personName';
import type { PersonaKey } from '../types';
import { ScoringPanel, MessagesPanel } from '../SettingsPanels';
import { AllocationRegister } from './AllocationRegister';
import { InventoryGrid } from './InventoryGrid';
import { PeopleRegister } from './PeopleRegister';
import { RequestQueue } from './RequestQueue';
import { Glyph } from './parts';
import { SetupWorkspace } from './SetupWorkspace';
import { UserAccess } from './UserAccess';

const areas = [
  { id: 'inventory', label: 'Event inventory', icon: 'inventory' },
  { id: 'requests', label: 'Request queue', icon: 'requests' },
  { id: 'transfer', label: 'Allocations', icon: 'transfer' },
  { id: 'people', label: 'Contact register', icon: 'people' },
  { id: 'setup', label: 'Setup & import', icon: 'setup' },
  { id: 'scoring', label: 'Scoring policy', icon: 'scoring' },
  { id: 'messages', label: 'Message previews', icon: 'messages' },
  { id: 'access', label: 'User access', icon: 'people' },
] as const;
type Area = typeof areas[number]['id'];

export function DesignWorkspace({ onRefresh, onPersona }: {
  onRefresh: () => Promise<boolean>;
  onPersona: (persona: PersonaKey) => void;
}) {
  const { snapshot, busy, persona } = useReview();
  const live = snapshot.mode === 'dataverse';
  const admin = snapshot.persona.role === 'coordinator';
  const [area, setArea] = useState<Area>(admin ? 'requests' : 'inventory');
  const [gameId, setGameId] = useState('');
  const [refreshState, setRefreshState] = useState<'idle' | 'refreshing' | 'updated'>('idle');
  useEffect(() => {
    if (refreshState !== 'updated') return;
    const timer = window.setTimeout(() => setRefreshState('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [refreshState]);
  const permitted = (id: Area) => id === 'access' ? !!snapshot.persona.isAppAdmin : admin || ['inventory', 'requests'].includes(id);
  const effectiveArea = permitted(area) ? area : 'inventory';
  const visibleAreas = areas.filter(a => permitted(a.id));
  const pending = snapshot.requests.filter(r => !['fulfilled', 'cancelled'].includes(r.status)).length;
  const awaitingTransfer = snapshot.allocations?.filter(a => a.status === 'approved').length ?? 0;
  const nav = <nav aria-label="Workspace navigation">{visibleAreas.map(a => <button key={a.id} type="button"
    aria-current={effectiveArea === a.id ? 'page' : undefined} onClick={() => setArea(a.id)}>
    <Glyph name={a.icon} /><span>{a.id === 'requests' && !admin ? 'My requests' : a.label}</span>
    {a.id === 'requests' && pending > 0 && <small>{pending}</small>}
    {a.id === 'transfer' && awaitingTransfer > 0 && <small>{awaitingTransfer}</small>}
  </button>)}</nav>;
  return <div className="work-shell work-shell--desk">
    <header className="work-app-header"><div className="work-brand"><img src={logoUrl} alt="AIS" /><span className="work-brand-divider" /><div><strong>Allocation desk</strong><span>Ticket management</span></div></div>
      <div className="work-header-tools"><span className="work-environment"><i />{live ? 'AIS Development' : 'Synthetic preview'}</span><button className={`work-refresh ${refreshState === 'refreshing' ? 'is-refreshing' : refreshState === 'updated' ? 'is-updated' : ''}`} disabled={busy || refreshState === 'refreshing'} aria-busy={refreshState === 'refreshing'} onClick={async () => {
        setRefreshState('refreshing');
        setRefreshState(await onRefresh() ? 'updated' : 'idle');
      }}><Glyph name={refreshState === 'updated' ? 'check' : 'refresh'} size={16} /><span aria-live="polite" aria-atomic="true">{refreshState === 'refreshing' ? 'Refreshing…' : refreshState === 'updated' ? 'Updated' : live ? 'Refresh data' : 'Reset demo'}</span></button><div className="work-user"><strong>{personName(snapshot.persona.name)}</strong><span>{snapshot.persona.email}</span></div></div>
    </header>
    <div className="work-top-navigation">{nav}<span>{admin ? 'Coordinator workspace' : 'Requester access'}</span></div>
    <div className="work-app-body">
      <main className="work-main">
        {!live && <label className="work-demo-persona">Preview role<select aria-label="Synthetic persona" value={persona} onChange={e => onPersona(e.target.value as PersonaKey)}>{Object.values(PERSONAS).map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</select></label>}
        {effectiveArea === 'inventory' && <InventoryGrid onRequests={id => { setGameId(id); setArea('requests'); }} />}
        {effectiveArea === 'requests' && <RequestQueue desk gameId={gameId} onGameChange={setGameId} />}
        {admin && effectiveArea === 'transfer' && <AllocationRegister />}
        {admin && effectiveArea === 'people' && <PeopleRegister />}
        {admin && effectiveArea === 'setup' && <SetupWorkspace />}
        {admin && effectiveArea === 'scoring' && <div className="work-embedded"><ScoringPanel /></div>}
        {admin && effectiveArea === 'messages' && <div className="work-embedded"><MessagesPanel /></div>}
        {snapshot.persona.isAppAdmin && effectiveArea === 'access' && <UserAccess />}
      </main>
    </div>
  </div>;
}
