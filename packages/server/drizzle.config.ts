import { defineConfig } from 'drizzle-kit';

// Optional: for developers who want to regenerate migrations from schema.ts.
// The app itself applies the hand-authored SQL in src/db/migrations at startup.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: { url: '../../data/app.db' },
});
