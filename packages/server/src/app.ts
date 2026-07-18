import 'express-async-errors';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { env, IS_PROD } from './env.js';
import { fromRoot } from './lib/paths.js';

import { teamsRouter, eventsRouter } from './modules/teams.js';
import { seasonsRouter } from './modules/seasons.js';
import { gamesRouter } from './modules/games.js';
import { inventoryRouter } from './modules/inventory.js';
import { requestsRouter, gameRequestsRouter } from './modules/requests.js';
import { assignmentsRouter, gameAssignmentsRouter, gameTransferRouter } from './modules/assignments.js';
import { waitlistRouter } from './modules/waitlist.js';
import { gameReservationsRouter, reservationsRouter } from './modules/reservations.js';
import { scoringRouter } from './modules/scoring.js';
import { contactsRouter } from './modules/contacts.js';
import { crmRouter } from './modules/crm.js';
import { directoryRouter } from './modules/directory.js';
import { dashboardsRouter } from './modules/dashboards.js';
import { integrationsRouter } from './modules/integrations.js';
import { notificationsRouter } from './modules/notifications.js';
import { exportRouter } from './modules/export.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'ais-ticket-concierge' }));

  app.use('/api/teams', teamsRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/seasons', seasonsRouter);
  app.use('/api/games', gamesRouter);
  app.use('/api/games/:gameId/seats', inventoryRouter);
  app.use('/api/games/:gameId/requests', gameRequestsRouter);
  app.use('/api/games/:gameId/assignments', gameAssignmentsRouter);
  app.use('/api/games/:gameId/transfer', gameTransferRouter);
  app.use('/api/games/:gameId/reservations', gameReservationsRouter);
  app.use('/api/requests', requestsRouter);
  app.use('/api/assignments', assignmentsRouter);
  app.use('/api/reservations', reservationsRouter);
  app.use('/api/waitlist', waitlistRouter);
  app.use('/api/scoring', scoringRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/api/crm', crmRouter);
  app.use('/api/directory', directoryRouter);
  app.use('/api/dashboards', dashboardsRouter);
  app.use('/api/integrations', integrationsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api', exportRouter);

  app.use('/api', notFoundHandler);

  // In production, serve the built client and fall back to index.html for SPA routes.
  const clientDist = fromRoot('packages/client/dist');
  if (IS_PROD && existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => res.sendFile(join(clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
