import { personName } from './personName';
import type { InterestView, ReviewSnapshot } from './types';

export function RequestIdentity({ request, snapshot }: { request: InterestView; snapshot: ReviewSnapshot }) {
  if (snapshot.persona.role !== 'coordinator') return null;
  const requester = snapshot.requesters?.find(p => p.id === request.requesterId);
  const own = request.requesterId === snapshot.persona.id;
  const name = request.requesterName || requester?.name || (own ? snapshot.persona.name : 'Historical requester');
  const email = request.requesterEmail || requester?.email || (own ? snapshot.persona.email : '');
  const recorder = request.recordedByName || snapshot.requesters?.find(p => p.id === request.recordedById)?.name;
  return <div className="text-sm text-slate-700 space-y-1">
    <p>Requested by: <strong title={name}>{personName(name)}</strong>{email && <span> · {email}</span>}</p>
    {request.recordedById && request.recordedById !== request.requesterId &&
      <p className="text-xs text-slate-500">Entered on their behalf by <span title={recorder}>{recorder ? personName(recorder) : 'a coordinator'}</span>.</p>}
  </div>;
}
