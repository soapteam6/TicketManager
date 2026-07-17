import { createApp } from './app.js';
import { env, IS_PROD } from './env.js';
import { sqlite } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { logger } from './lib/logger.js';

// Apply any pending migrations on boot so the app is self-healing on first run.
const ran = runMigrations(sqlite);
if (ran.length) logger.info({ ran }, 'Applied migrations on startup');

const app = createApp();

app.listen(env.PORT, () => {
  logger.info(`AIS Ticket Concierge API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  if (!IS_PROD) logger.info(`Client dev server proxies /api to this port.`);
});
