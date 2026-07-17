import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { crmSearchQuery, type CrmStatus } from '@ais/shared';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { getCrmAdapter } from '../adapters/crm/index.js';
import { logIntegration } from '../adapters/integration-log.js';
import { badRequest } from '../lib/errors.js';

export const crmRouter = Router();
crmRouter.use(requireAuth);

crmRouter.get('/status', (_req: Request, res: Response) => {
  const adapter = getCrmAdapter();
  const status: CrmStatus = { configured: adapter.provider === 'dynamics', provider: adapter.provider };
  res.json(status);
});

// Step 1: search companies (accounts).
crmRouter.get('/accounts', validate(crmSearchQuery, 'query'), async (req: Request, res: Response) => {
  const { q } = req.query as unknown as { q: string };
  const adapter = getCrmAdapter();
  const started = Date.now();
  try {
    const accounts = await adapter.searchAccounts(q);
    logIntegration({ adapter: 'crm', operation: 'searchAccounts', status: 'success', payload: { q, provider: adapter.provider }, response: { count: accounts.length }, durationMs: Date.now() - started });
    res.json({ accounts, provider: adapter.provider });
  } catch (err) {
    logIntegration({ adapter: 'crm', operation: 'searchAccounts', status: 'error', payload: { q, provider: adapter.provider }, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started });
    res.status(502).json({ error: 'CRM account search failed', detail: err instanceof Error ? err.message : String(err) });
  }
});

// Step 2: list the contacts within a selected account.
const accountParam = z.object({ accountId: z.string().min(1) });
crmRouter.get('/accounts/:accountId/contacts', validate(accountParam, 'params'), async (req: Request, res: Response) => {
  const { accountId } = req.params as unknown as { accountId: string };
  if (!accountId) throw badRequest('accountId required');
  const adapter = getCrmAdapter();
  const started = Date.now();
  try {
    const contacts = await adapter.listContacts(accountId);
    logIntegration({ adapter: 'crm', operation: 'listContacts', status: 'success', requestRef: accountId, payload: { provider: adapter.provider }, response: { count: contacts.length }, durationMs: Date.now() - started });
    res.json({ contacts, provider: adapter.provider });
  } catch (err) {
    logIntegration({ adapter: 'crm', operation: 'listContacts', status: 'error', requestRef: accountId, payload: { provider: adapter.provider }, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started });
    res.status(502).json({ error: 'CRM contact lookup failed', detail: err instanceof Error ? err.message : String(err) });
  }
});

// Step 3: list opportunities on a selected account (revenue = Manual Rep Credit).
crmRouter.get('/accounts/:accountId/opportunities', validate(accountParam, 'params'), async (req: Request, res: Response) => {
  const { accountId } = req.params as unknown as { accountId: string };
  const adapter = getCrmAdapter();
  const started = Date.now();
  try {
    const opportunities = await adapter.listOpportunities(accountId);
    logIntegration({ adapter: 'crm', operation: 'listOpportunities', status: 'success', requestRef: accountId, payload: { provider: adapter.provider }, response: { count: opportunities.length }, durationMs: Date.now() - started });
    res.json({ opportunities, provider: adapter.provider });
  } catch (err) {
    logIntegration({ adapter: 'crm', operation: 'listOpportunities', status: 'error', requestRef: accountId, payload: { provider: adapter.provider }, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started });
    res.status(502).json({ error: 'CRM opportunity lookup failed', detail: err instanceof Error ? err.message : String(err) });
  }
});
