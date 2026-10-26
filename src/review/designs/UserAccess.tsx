import { useState } from 'react';
import { useReview } from '../context';
import { personName } from '../personName';
import type { AccessUser, AppRole } from '../types';
import { Button, Field, Select } from '../ui';
import { EmptyRows, Glyph, Search } from './parts';
import { rowSelection } from './rowSelection';
import { GroupAccess } from './GroupAccess';

const labels = { coordinator: 'Coordinator', rep: 'Sales representative', employee: 'Employee', none: 'No app access' };
export function UserAccess() {
  const { snapshot } = useReview();
  const [section, setSection] = useState<'people' | 'groups'>('people');
  if (!snapshot.persona.isAppAdmin) return null;
  return <section className="work-surface">
    <div className="work-section-heading"><div><h2>User access</h2><p>Assign app roles to people or existing directory groups.</p></div>
      <div className="work-access-sections" role="group" aria-label="Access type"><button aria-pressed={section === 'people'} onClick={() => setSection('people')}>People</button><button aria-pressed={section === 'groups'} onClick={() => setSection('groups')}>Groups</button></div>
    </div>
    {section === 'people' ? <PeopleAccess /> : <GroupAccess />}
  </section>;
}

function PeopleAccess() {
  const { snapshot } = useReview();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  if (!snapshot.persona.isAppAdmin) return null;
  const users = (snapshot.accessUsers ?? []).filter(u => `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => personName(a.name).localeCompare(personName(b.name)));
  const selected = users.find(u => u.id === selectedId);
  return <>
    <div className="work-toolbar"><Search value={query} onChange={value => { setQuery(value); setSelectedId(''); }} placeholder="Search name or email" /><span className="work-toolbar-count">{users.length} users</span></div>
    <div className={`work-people-split ${selected ? 'has-inspector' : ''}`}>
      <div className="work-table-scroll"><table className="work-table"><thead><tr><th>Name / email</th><th>Effective access</th><th>Assigned role</th><th>From teams</th></tr></thead><tbody>{users.map(u => <tr key={u.id} className={u.id === selectedId ? 'is-selected' : ''} {...rowSelection(u.id === selectedId, () => setSelectedId(u.id))}>
        <td><button className="work-record-link" onClick={() => setSelectedId(u.id)}>{personName(u.name)}</button><small>{u.email || u.id}</small></td>
        <td>{u.isAppAdmin ? 'Admin' : labels[u.effectiveRole]}</td><td>{u.directRoles.map(r => labels[r]).join(', ') || 'None'}</td><td>{u.inheritedRoles.map(r => labels[r]).join(', ') || 'None'}</td>
      </tr>)}</tbody></table>{!users.length && <EmptyRows>No matching Dataverse users.</EmptyRows>}</div>
      {selected && <aside className="work-contact-detail" aria-label="User access details"><div className="work-inspector-heading"><strong>User access</strong><button className="work-icon-button" aria-label="Close user access" onClick={() => setSelectedId('')}><Glyph name="close" size={16} /></button></div>
        <h3>{personName(selected.name)}</h3><p className="work-help">{selected.email}</p>
        <AccessEditor key={`${selected.id}:${selected.directRoles.join(',')}`} user={selected} />
      </aside>}
    </div>
  </>;
}

function AccessEditor({ user }: { user: AccessUser }) {
  const { run, busy } = useReview();
  const [role, setRole] = useState<AppRole | 'none'>(user.directRoles.includes('coordinator') ? 'coordinator' : user.directRoles.includes('rep') ? 'rep' : user.directRoles.includes('employee') ? 'employee' : 'none');
  if (user.isAppAdmin) return <p className="work-help work-access-note">Admin accounts have coordinator access and can assign app roles. The admin list is maintained in the application.</p>;
  return <form className="work-access-form" onSubmit={async e => {
    e.preventDefault();
    await run({ type: 'setUserRole', userId: user.id, role, expectedDirectRoles: user.directRoles });
  }}>
    <Field label="Assigned app role"><Select value={role} onChange={e => setRole(e.target.value as AppRole | 'none')}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
    <p className="work-help">Coordinators manage inventory and allocations. Sales representatives request for customers or themselves. Employees request for themselves.</p>
    {user.inheritedRoles.length > 0 && <p className="work-help">Team access remains: {user.inheritedRoles.map(r => labels[r]).join(', ')}. Manage linked group roles in Groups. Group membership is managed in Microsoft Entra; other teams are managed in Dataverse.</p>}
    <p className="work-help">Users also need the app shared with them and access to this environment.</p>
    <Button type="submit" disabled={busy || (user.directRoles.length <= 1 && role === (user.directRoles[0] ?? 'none'))}>Save role</Button>
  </form>;
}
