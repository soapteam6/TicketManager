import { useState } from 'react';
import { useReview } from '../context';
import type { AccessGroup, AppRole } from '../types';
import { Button, Field, Select, TextInput } from '../ui';
import { EmptyRows, Glyph, Search } from './parts';
import { rowSelection } from './rowSelection';

const labels = { coordinator: 'Coordinator', rep: 'Sales representative', employee: 'Employee', none: 'No app role' };
const membershipLabels = { members: 'Members', owners: 'Owners', guests: 'Guests', membersAndGuests: 'Members and guests' };
export function GroupAccess() {
  const { snapshot } = useReview();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const groups = (snapshot.accessGroups ?? []).filter(g => `${g.name} ${g.directoryId}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const selected = groups.find(g => g.id === selectedId);
  return <>
    <div className="work-toolbar"><Search value={query} onChange={value => { setQuery(value); setSelectedId(''); setConnecting(false); }} placeholder="Search linked group or ID" /><Button onClick={() => { setSelectedId(''); setConnecting(true); }}>Connect group</Button><span className="work-toolbar-count">{groups.length} groups</span></div>
    <div className={`work-people-split ${selected || connecting ? 'has-inspector' : ''}`}>
      <div className="work-table-scroll"><table className="work-table"><thead><tr><th>Group / directory ID</th><th>Type</th><th>Membership</th><th>App role</th></tr></thead><tbody>{groups.map(g => <tr key={g.id} className={g.id === selectedId ? 'is-selected' : ''} {...rowSelection(g.id === selectedId, () => { setSelectedId(g.id); setConnecting(false); })}>
        <td><button className="work-record-link" onClick={() => { setSelectedId(g.id); setConnecting(false); }}>{g.name}</button><small>{g.directoryId}</small></td><td>{g.type === 'security' ? 'Security group' : 'Microsoft 365'}</td><td>{membershipLabels[g.membership]}</td><td>{g.roles.map(r => labels[r]).join(', ') || 'None'}</td>
      </tr>)}</tbody></table>{!groups.length && <EmptyRows>{query ? 'No matching linked groups.' : 'Connect an existing Entra group to assign a role to its members.'}</EmptyRows>}</div>
      {(selected || connecting) && <aside className="work-contact-detail" aria-label="Group access details"><div className="work-inspector-heading"><strong>{connecting ? 'Connect a directory group' : 'Group access'}</strong><button className="work-icon-button" aria-label="Close group access" onClick={() => { setSelectedId(''); setConnecting(false); }}><Glyph name="close" size={16} /></button></div>
        {connecting ? <ConnectGroup onConnected={id => { setSelectedId(id); setConnecting(false); setQuery(''); }} /> : selected && <><h3>{selected.name}</h3><p className="work-help work-group-id">{selected.directoryId}</p><GroupEditor key={`${selected.id}:${selected.roles.join(',')}`} group={selected} /></>}
      </aside>}
    </div>
  </>;
}

function GroupEditor({ group }: { group: AccessGroup }) {
  const { run, busy } = useReview();
  const [role, setRole] = useState<AppRole | 'none'>(group.roles.includes('coordinator') ? 'coordinator' : group.roles.includes('rep') ? 'rep' : group.roles.includes('employee') ? 'employee' : 'none');
  return <form className="work-access-form" onSubmit={async e => {
    e.preventDefault(); await run({ type: 'setGroupRole', groupId: group.id, role, expectedRoles: group.roles });
  }}>
    <Field label="Group app role"><Select name="groupRole" value={role} onChange={e => setRole(e.target.value as AppRole | 'none')}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
    <p className="work-help">This role applies to the group’s {membershipLabels[group.membership].toLowerCase()}. Membership is managed in Microsoft Entra and checked by Dataverse when users sign in. Changes can take time to appear.</p>
    <p className="work-help">Direct roles and roles from other groups still apply. App sharing and environment access are separate.</p>
    <Button type="submit" disabled={busy || (group.roles.length <= 1 && role === (group.roles[0] ?? 'none'))}>Save group role</Button>
  </form>;
}

function ConnectGroup({ onConnected }: { onConnected: (id: string) => void }) {
  const { run, provider, persona, busy } = useReview();
  const [directoryId, setDirectoryId] = useState('');
  const [role, setRole] = useState<AppRole>('rep');
  return <form className="work-access-form" onSubmit={async e => {
    e.preventDefault();
    if (await run({ type: 'connectGroup', directoryId: directoryId.trim(), role })) {
      const group = provider.snapshot(persona).accessGroups?.find(g => g.directoryId.toLowerCase() === directoryId.trim().toLowerCase() && g.membership === 'members');
      if (group) onConnected(group.id);
    }
  }}>
    <Field label="Microsoft Entra group Object ID" required><TextInput name="groupDirectoryId" required autoComplete="off" value={directoryId} onChange={e => setDirectoryId(e.target.value)} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" placeholder="Group Object ID" /></Field>
    <p className="work-help">Copy the Object ID from the existing group’s overview in Microsoft Entra. Dataverse validates it and supplies the group’s name.</p>
    <Field label="App role"><Select name="newGroupRole" value={role} onChange={e => setRole(e.target.value as AppRole)}>{Object.entries(labels).filter(([key]) => key !== 'none').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
    <p className="work-help">This connects existing group members. Guests are excluded. It does not create a directory group or copy its members into individual role assignments.</p>
    <Button type="submit" disabled={busy}>Connect and assign role</Button>
  </form>;
}
