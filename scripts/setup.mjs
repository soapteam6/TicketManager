// One-time setup: ensure .env exists, apply migrations, seed the demo dataset.
import { existsSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

const envPath = resolve(root, '.env');
if (!existsSync(envPath)) {
  copyFileSync(resolve(root, '.env.example'), envPath);
  console.log('Created .env from .env.example (edit secrets before any real deployment).');
}

console.log('\nApplying database migrations...');
run('npm run db:migrate');

console.log('\nSeeding base data (admin + scoring config)...');
run('npm run seed');

console.log('\nSetup complete. Run "npm run dev" to start the app.');
console.log('(For a sample dataset to explore, run "npm run seed:demo".)');
