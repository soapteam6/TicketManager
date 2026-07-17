// End-to-end API smoke test against a running server (node 22 global fetch).
const BASE = 'http://localhost:4000/api';
let token = '';
const H = () => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
const j = async (r) => {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
};
const step = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
let failures = 0;
const assert = (name, cond, extra) => { if (!cond) failures++; step(name, cond, extra); };

// 1. Login
let res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: H(), body: JSON.stringify({ email: 'admin@ais.local', password: 'ChangeMe123!' }) });
let body = await j(res);
token = body.accessToken;
assert('login', res.status === 200 && !!token, `role=${body.user?.role}`);

// 2. Dashboard overview
res = await fetch(`${BASE}/dashboards/overview`, { headers: H() });
body = await j(res);
assert('dashboards/overview', res.status === 200, `teams=${body.teams} upcomingGames=${body.upcomingGames} totalSeats=${body.totalSeats}`);

// 3. Games list -> pick an upcoming game with requests
res = await fetch(`${BASE}/games`, { headers: H() });
const games = (await j(res)).games ?? [];
const now = Date.now();
const upcoming = games.filter((g) => g.gameDate >= now && g.status === 'scheduled');
assert('games list', games.length > 0, `${games.length} games, ${upcoming.length} upcoming`);
const game = upcoming[0];

// 4. Score & rank the game
res = await fetch(`${BASE}/games/${game.id}/requests/score`, { method: 'POST', headers: H(), body: '{}' });
body = await j(res);
const ranking = body.ranking ?? body;
assert('score game', res.status === 200 && Array.isArray(ranking.ranked), `${ranking.ranked?.length} ranked, narrative.available=${body.narrative?.available}`);
if (ranking.ranked?.[0]) {
  const top = ranking.ranked[0];
  console.log(`      top: ${top.requesterName} score=${top.finalScore} rec=${top.recommendation} factors=${top.breakdown?.length}`);
}

// 5. Recommend assignments (creates proposed + waitlist)
res = await fetch(`${BASE}/games/${game.id}/assignments/recommend`, { method: 'POST', headers: H(), body: JSON.stringify({ approve: false }) });
body = await j(res);
assert('recommend', res.status === 200, `assigned=${body.assigned} waitlisted=${body.waitlisted}`);

// 6. List assignments
res = await fetch(`${BASE}/assignments?gameId=${game.id}`, { headers: H() });
const assignments = (await j(res)).assignments ?? [];
assert('assignments list', assignments.length > 0, `${assignments.length} assignments`);

// 7. Approve first proposed, then attempt double-assign its seat (expect 409)
const proposed = assignments.find((a) => a.status === 'proposed');
if (proposed) {
  res = await fetch(`${BASE}/assignments/${proposed.id}/approve`, { method: 'POST', headers: H() });
  assert('approve assignment', res.status === 200);
  // Duplicate-seat guard: assign the same seat to another request -> 409
  const otherReq = assignments.find((a) => a.requestId !== proposed.requestId);
  if (otherReq) {
    res = await fetch(`${BASE}/assignments`, { method: 'POST', headers: H(), body: JSON.stringify({ requestId: otherReq.requestId, seatId: proposed.seatId }) });
    assert('duplicate-seat blocked (409)', res.status === 409, `status=${res.status}`);
  }
}

// 8. Transfer approved assignments for the game
res = await fetch(`${BASE}/games/${game.id}/transfer`, { method: 'POST', headers: H(), body: '{}' });
body = await j(res);
assert('transfer game', res.status === 200, `transferred=${body.transferred} failed=${body.failed}`);

// 9. Record attendance on a transferred assignment
res = await fetch(`${BASE}/assignments?gameId=${game.id}&status=transferred`, { headers: H() });
const transferred = (await j(res)).assignments ?? [];
if (transferred[0]) {
  res = await fetch(`${BASE}/assignments/${transferred[0].id}/attendance`, { method: 'POST', headers: H(), body: JSON.stringify({ ticketStatus: 'attended', designation: 'customer', businessGenerated: 12000 }) });
  assert('record attendance', res.status === 200);
}

// 10. ROI dashboard reflects business
res = await fetch(`${BASE}/dashboards/roi`, { headers: H() });
body = await j(res);
assert('dashboards/roi', res.status === 200, `total=${body.total}`);

// 11. Excel export
res = await fetch(`${BASE}/season.xlsx`, { headers: H() });
const ct = res.headers.get('content-type') ?? '';
const buf = Buffer.from(await res.arrayBuffer());
assert('export xlsx', res.status === 200 && ct.includes('spreadsheet') && buf.length > 0, `${buf.length} bytes`);

// 12. Waitlist
res = await fetch(`${BASE}/waitlist?gameId=${game.id}`, { headers: H() });
body = await j(res);
assert('waitlist', res.status === 200, `${(body.waitlist ?? []).length} entries`);

console.log(`\n${failures === 0 ? 'ALL SMOKE CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
