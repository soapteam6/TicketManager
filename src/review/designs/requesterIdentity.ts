import { personName } from '../personName';
import type { InterestView, ReviewSnapshot } from '../types';

export function requesterIdentity(request: InterestView, snapshot: ReviewSnapshot) {
  const match = snapshot.requesters?.find(p => p.id === request.requesterId);
  const own = request.requesterId === snapshot.persona.id;
  return {
    name: personName(request.requesterName || match?.name || (own ? snapshot.persona.name : 'Historical requester')),
    email: request.requesterEmail || match?.email || (own ? snapshot.persona.email : ''),
  };
}
