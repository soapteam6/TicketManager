// Validate the saved live job using the same parser as the application.
// No service calls; raw tool content stays in the ignored artifacts directory.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const stem = process.argv[2] || 'schedule-search-live';
assert(/^[a-z0-9-]+$/.test(stem));
const result = JSON.parse(await readFile(`design-artifacts.local/${stem}.json`, 'utf8'));
const check = JSON.parse(await readFile(`design-artifacts.local/${stem}-check.json`, 'utf8'));
assert.equal(result.id, check.jobId);
assert.equal(result.status, 'complete');
assert.equal(check.workspaceUnchanged, true);
const compiled = await build({ entryPoints: ['src/review/scheduleDiscovery.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { parseScheduleDiscovery, discoveredGameIssues } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
const found = parseScheduleDiscovery(result.rawResult, result.request);
const ready = found.games.filter(g => g.selected && !discoveredGameIssues(g, [], result.request.homeOnly).length);
assert(found.sources.length > 0 && (ready.length > 0 || found.games.length === 0 && found.warnings.length > 0), 'No source-backed schedule or explained empty result');
const record = {
  authenticatedAs: 'emikes@ais-now.com', jobId: result.id, query: result.request.query,
  status: result.status, team: found.team, season: found.season, timezone: found.timezone,
  existingSeasonRequired: !!result.request.seasonId,
  gamesFound: found.games.length, gamesReadyForReview: ready.length,
  gamesWithUnconfirmedTimes: found.games.filter(g => !g.startAt).length,
  toolReturnedSources: found.sources.length, warnings: found.warnings.length,
  workspaceUnchanged: check.workspaceUnchanged, inventoryImported: check.inventoryImported,
  ...(stem === 'ai-import-live' && { notes: found.warnings }),
};
await writeFile(stem === 'ai-import-live' ? 'solutions/ai-import-test.json' : 'solutions/schedule-search-test.json', JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record, null, 2));
