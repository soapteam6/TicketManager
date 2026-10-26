import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MockReviewProvider } from './provider';
import { RequestIdentity } from './RequestIdentity';
import { PERSONAS } from './fixtures';
import { personName } from './personName';

describe('request identities', () => {
  it('separates requester and on-behalf recorder from beneficiaries', () => {
    const snapshot = new MockReviewProvider().snapshot('coordinator');
    const request = snapshot.requests[0];
    const html = renderToStaticMarkup(createElement(RequestIdentity, { request, snapshot }));
    expect(html).toContain('Requested by:');
    expect(html).toContain(PERSONAS.rep.name);
    expect(html).toContain(PERSONAS.coordinator.name);
    expect(html).toContain('Entered on their behalf');
    expect(html).not.toContain('Alex Sample');
  });
  it('does not project coordinator identity metadata to requesters', () => {
    const provider = new MockReviewProvider();
    const snapshot = provider.snapshot('rep');
    expect(snapshot.requests[0]).not.toHaveProperty('requesterName');
    expect(snapshot.requests[0]).not.toHaveProperty('requesterEmail');
    expect(snapshot.requests[0]).not.toHaveProperty('recordedById');
    expect(snapshot.requests[0]).not.toHaveProperty('recordedByName');
    const html = renderToStaticMarkup(createElement(RequestIdentity, {
      request: { ...snapshot.requests[0], requesterName: 'Private coordinator metadata' }, snapshot,
    }));
    expect(html).toBe('');
  });
  it('keeps source spelling while displaying a readable person name', () => {
    expect(personName('# Example Person')).toBe('Example Person');
    expect(personName('Example # Person')).toBe('Example # Person');
    const snapshot = new MockReviewProvider().snapshot('coordinator');
    const request = { ...snapshot.requests[0], requesterName: '# Example Person' };
    const html = renderToStaticMarkup(createElement(RequestIdentity, { request, snapshot }));
    expect(html).toContain('title="# Example Person">Example Person</strong>');
    expect(request.requesterName).toBe('# Example Person');
  });
});
