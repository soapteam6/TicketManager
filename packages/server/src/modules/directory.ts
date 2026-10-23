import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { DirectoryStatus } from '@ais/shared';
import { db } from '../db/client.js';
import { contacts } from '../db/schema.js';
import { requireRole } from '../middleware/requireRole.js';
import { syncDirectorySnapshot } from './directory-service.js';
import { MockDirectoryAdapter } from '../adapters/directory/mock.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { getDirectoryAdapter } from '../adapters/directory/index.js';
import { logIntegration } from '../adapters/integration-log.js';

export const directoryRouter = Router();
directoryRouter.use(requireAuth);

const searchQuery = z.object({ q: z.string().min(1) });

directoryRouter.get('/status', (_req: Request, res: Response) => {
  const adapter = getDirectoryAdapter();
  const status: DirectoryStatus = { configured: adapter.provider === 'graph', provider: adapter.provider };
  res.json(status);
});

directoryRouter.get('/search', validate(searchQuery, 'query'), async (req: Request, res: Response) => {
  const { q } = req.query as unknown as { q: string };
  const adapter = getDirectoryAdapter();
  const started = Date.now();
  try {
    const users = await adapter.searchUsers(q);
    logIntegration({ adapter: 'directory', operation: 'search', status: 'success', payload: { q, provider: adapter.provider }, response: { count: users.length }, durationMs: Date.now() - started });
    const inactive = new Set(db.select().from(contacts).all().filter((c) => !c.isActive || !c.directoryActive).map((c) => c.directoryUserId));
    res.json({ users: users.filter((u) => !inactive.has(u.id)), provider: adapter.provider });
  } catch (err) {
    logIntegration({ adapter: 'directory', operation: 'search', status: 'error', payload: { q, provider: adapter.provider }, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started });
    res.status(502).json({ error: 'Directory search failed', detail: err instanceof Error ? err.message : String(err) });
  }
});

directoryRouter.post('/sync-mock', requireRole('admin'), async (_req, res) => {
  res.json(syncDirectorySnapshot(await new MockDirectoryAdapter().searchUsers('')));
});
