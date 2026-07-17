import { existsSync, rmSync } from 'node:fs';
import { DB_PATH } from '../env.js';

// Delete the SQLite files BEFORE anything opens a connection, then migrate + seed fresh.
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${DB_PATH}${suffix}`;
  if (existsSync(file)) {
    rmSync(file);
    console.log(`Removed ${file}`);
  }
}

// Reset produces a clean slate (admin + scoring config only). For the full sample dataset,
// run `npm run seed:demo` after a reset.
await import('./seed/index.js');
