// Invoked only by the reviewed demo launcher; no .env, real DB, or external APIs.
import { createApp } from './app.js';
import { sqlite } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { seedReviewFixture } from './db/seed/review-fixture.js';
import { env } from './env.js';
if (!env.LOCAL_MOCK_MODE || env.NODE_ENV === 'production') throw new Error('Local mock mode required');
runMigrations(sqlite);
await seedReviewFixture();
const server = createApp().listen(env.PORT, '127.0.0.1', () => console.log(`Synthetic review API: http://127.0.0.1:${env.PORT}. Reset by restarting. No real delivery or integrations.`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  server.close(() => { sqlite.close(); process.exit(0); });
});
