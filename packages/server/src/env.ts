import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { REPO_ROOT, fromRoot } from './lib/paths.js';

loadDotenv({ path: fromRoot('.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default('./data/app.db'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@ais.local'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('ChangeMe123!'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  EMAIL_INTAKE_MODE: z.enum(['mock', 'graph']).default('mock'),
  EXPORT_MODE: z.enum(['local', 'onedrive']).default('local'),
  TICKETING_PROVIDER: z.string().default('mock'),
  SEED_DEMO: z.coerce.boolean().default(false),
  // Dynamics 365 CRM (optional — when all are set, live CRM is used instead of sample data).
  DYNAMICS_URL: z.string().optional(), // e.g. https://yourorg.crm.dynamics.com
  DYNAMICS_TENANT_ID: z.string().optional(),
  DYNAMICS_CLIENT_ID: z.string().optional(),
  DYNAMICS_CLIENT_SECRET: z.string().optional(),
  // Logical name of the opportunity "revenue" money field (default = AIS Manual Rep Credit).
  DYNAMICS_OPP_REVENUE_FIELD: z.string().default('ais_manualrepcredit'),
  // OData filter fragment that restricts account search to parent accounts only. Default assumes
  // a Yes/No column `ais_isparent`; change to e.g. `ais_isparent eq 1` for a choice column.
  DYNAMICS_ACCOUNT_PARENT_FILTER: z.string().default('ais_isparent eq true'),
  // Entra directory source: 'auto' = live Graph when creds present, else sample. Set 'mock' to
  // force sample employees (e.g. while Graph admin consent is pending).
  DIRECTORY_PROVIDER: z.enum(['auto', 'graph', 'mock']).default('auto'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast with a readable message rather than crashing deep in a handler.
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed. Copy .env.example to .env and fill in the values.');
}

export const env = parsed.data;
export const DB_PATH = env.DATABASE_URL === ':memory:' ? ':memory:' : fromRoot(env.DATABASE_URL);
export const IS_PROD = env.NODE_ENV === 'production';
export const IS_TEST = env.NODE_ENV === 'test';
export { REPO_ROOT };

export const narrativeEnabled = Boolean(env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim().length > 0);

export const crmConfigured = Boolean(
  env.DYNAMICS_URL && env.DYNAMICS_TENANT_ID && env.DYNAMICS_CLIENT_ID && env.DYNAMICS_CLIENT_SECRET
);
