import { describe, expect, it } from 'vitest';
import { PERSONAS } from './fixtures';
import { MockReviewProvider } from './provider';

describe('app role management', () => {
  it('projects the user directory only to app admins', async () => {
    const provider = new MockReviewProvider();
    expect(provider.snapshot('coordinator').accessUsers).toHaveLength(3);
    expect(provider.snapshot('rep').accessUsers).toBeUndefined();
    await provider.execute('coordinator', { type: 'setUserRole', userId: PERSONAS.rep.id, role: 'coordinator', expectedDirectRoles: ['rep'] });
    expect(provider.snapshot('rep').persona).toMatchObject({ role: 'coordinator' });
    expect(provider.snapshot('rep').persona.isAppAdmin).toBeFalsy();
    expect(provider.snapshot('rep').accessUsers).toBeUndefined();
    await expect(provider.execute('rep', { type: 'setUserRole', userId: PERSONAS.employee.id, role: 'rep', expectedDirectRoles: ['employee'] })).rejects.toThrow('Only an app admin');
  });
  it('does not allow changes to fixed app admins', async () => {
    const provider = new MockReviewProvider();
    await expect(provider.execute('coordinator', { type: 'setUserRole', userId: PERSONAS.coordinator.id, role: 'none', expectedDirectRoles: [] })).rejects.toThrow('Select a user');
    expect(provider.snapshot('coordinator').persona.isAppAdmin).toBe(true);
  });
  it('rejects stale direct-role edits and preserves the completed edit', async () => {
    const provider = new MockReviewProvider();
    await provider.execute('coordinator', { type: 'setUserRole', userId: PERSONAS.rep.id, role: 'employee', expectedDirectRoles: ['rep'] });
    await expect(provider.execute('coordinator', { type: 'setUserRole', userId: PERSONAS.rep.id, role: 'coordinator', expectedDirectRoles: ['rep'] })).rejects.toThrow('roles changed');
    expect(provider.snapshot('rep').persona.key).toBe('employee');
  });
  it('makes role grants reversible and removes app access when revoked', async () => {
    const provider = new MockReviewProvider();
    await provider.execute('coordinator', { type: 'setUserRole', userId: PERSONAS.rep.id, role: 'none', expectedDirectRoles: ['rep'] });
    expect(() => provider.snapshot('rep')).toThrow('role is required');
    await provider.execute('coordinator', { type: 'setUserRole', userId: PERSONAS.rep.id, role: 'rep', expectedDirectRoles: [] });
    expect(provider.snapshot('rep').persona.key).toBe('rep');
  });
  it('applies group roles without copying direct assignments and preserves inherited access on direct removal', async () => {
    const provider = new MockReviewProvider();
    const group = provider.snapshot('coordinator').accessGroups![0];
    await provider.execute('coordinator', { type: 'setGroupRole', groupId: group.id, role: 'rep', expectedRoles: [] });
    await provider.execute('coordinator', { type: 'setUserRole', userId: PERSONAS.rep.id, role: 'none', expectedDirectRoles: ['rep'] });
    expect(provider.snapshot('rep').persona.key).toBe('rep');
    expect(provider.snapshot('coordinator').accessUsers!.find(u => u.id === PERSONAS.rep.id)).toMatchObject({ directRoles: [], inheritedRoles: ['rep'], effectiveRole: 'rep' });
    expect(provider.snapshot('rep').accessGroups).toBeUndefined();
    await provider.execute('coordinator', { type: 'setGroupRole', groupId: group.id, role: 'none', expectedRoles: ['rep'] });
    expect(() => provider.snapshot('rep')).toThrow('role is required');
  });
  it('does not grant app administration through a coordinator group', async () => {
    const provider = new MockReviewProvider();
    const group = provider.snapshot('coordinator').accessGroups![0];
    await provider.execute('coordinator', { type: 'setGroupRole', groupId: group.id, role: 'coordinator', expectedRoles: [] });
    expect(provider.snapshot('rep').persona.role).toBe('coordinator');
    expect(provider.snapshot('rep').accessGroups).toBeUndefined();
    await expect(provider.execute('rep', { type: 'setGroupRole', groupId: group.id, role: 'none', expectedRoles: ['coordinator'] })).rejects.toThrow('Only an app admin');
  });
  it('rejects stale group edits and duplicate connections', async () => {
    const provider = new MockReviewProvider();
    const group = provider.snapshot('coordinator').accessGroups![0];
    await provider.execute('coordinator', { type: 'setGroupRole', groupId: group.id, role: 'rep', expectedRoles: [] });
    await expect(provider.execute('coordinator', { type: 'setGroupRole', groupId: group.id, role: 'coordinator', expectedRoles: [] })).rejects.toThrow('roles changed');
    await expect(provider.execute('coordinator', { type: 'connectGroup', directoryId: group.directoryId, role: 'rep' })).rejects.toThrow('already linked');
    expect(provider.snapshot('coordinator').accessGroups![0].roles).toEqual(['rep']);
  });
});
