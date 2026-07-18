import type BetterSqlite3 from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { fromRoot } from '../lib/paths.js';

const MIGRATIONS_DIR = fromRoot('packages/server/src/db/migrations');

// Apply any not-yet-applied .sql migrations, tracked in the _migrations table.
export function runMigrations(sqlite: BetterSqlite3.Database): string[] {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);`
  );

  const applied = new Set(
    (sqlite.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map((r) => r.id)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');
    // Migrations that rebuild a table referenced by ON DELETE CASCADE foreign keys must run
    // with foreign_keys OFF, which SQLite only honors OUTSIDE a transaction. Such files opt in
    // via a leading `-- migrate:no-transaction` directive and manage their own BEGIN/COMMIT.
    if (/^\s*--\s*migrate:no-transaction/m.test(sql)) {
      const fkOn = sqlite.pragma('foreign_keys', { simple: true }) === 1;
      sqlite.pragma('foreign_keys = OFF');
      try {
        sqlite.exec(sql);
      } finally {
        if (fkOn) sqlite.pragma('foreign_keys = ON');
      }
      sqlite.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)').run(file, Date.now());
    } else {
      const tx = sqlite.transaction(() => {
        sqlite.exec(sql);
        sqlite.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)').run(file, Date.now());
      });
      tx();
    }
    ran.push(file);
  }
  return ran;
}

// CLI entry: `tsx src/db/migrate.ts`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.ts')) {
  const { sqlite } = await import('./client.js');
  const ran = runMigrations(sqlite);
  if (ran.length) console.log(`Applied migrations: ${ran.join(', ')}`);
  else console.log('No pending migrations.');
  process.exit(0);
}
