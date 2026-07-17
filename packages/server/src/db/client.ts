import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DB_PATH } from '../env.js';
import * as schema from './schema.js';

export type DbHandle = {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
};

export function createSqlite(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return sqlite;
}

export function createDb(path: string): DbHandle {
  const sqlite = createSqlite(path);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// Application-wide singleton connection.
const handle = createDb(DB_PATH);
export const sqlite: Database.Database = handle.sqlite;
export const db = handle.db;
