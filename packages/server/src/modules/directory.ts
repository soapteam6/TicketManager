import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { DirectoryStatus } from '@ais/shared';
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
    res.json({ users, provider: adapter.provider });
  } catch (err) {
    logIntegration({ adapter: 'directory', operation: 'search', status: 'error', payload: { q, provider: adapter.provider }, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started });
    res.status(502).json({ error: 'Directory search failed', detail: err instanceof Error ? err.message : String(err) });
  }
});
