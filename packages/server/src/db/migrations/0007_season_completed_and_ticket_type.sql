-- migrate:no-transaction
-- Two changes:
--  1. Allow 'completed' as a season status. SQLite can't ALTER a CHECK constraint, so the
--     seasons table is rebuilt. Because games.season_id references seasons ON DELETE CASCADE,
--     dropping the old table with foreign keys enabled would cascade-delete every game — so the
--     runner applies this file with foreign_keys OFF (see the directive above), and we rebuild
--     via create-new / drop-old / rename (never renaming the original, which would rewrite the
--     child FK to a dangling name).
--  2. Add a free-text ticket_type to seats (Standard, VIP Suite, …).
BEGIN;

CREATE TABLE seasons_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_date INTEGER NOT NULL,
  end_date INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed','archived')),
  created_at INTEGER NOT NULL
);

INSERT INTO seasons_new (id, team_id, label, start_date, end_date, status, created_at)
SELECT id, team_id, label, start_date, end_date, status, created_at FROM seasons;

DROP TABLE seasons;
ALTER TABLE seasons_new RENAME TO seasons;
CREATE UNIQUE INDEX uq_season_team_label ON seasons(team_id, label);

ALTER TABLE seats ADD COLUMN ticket_type TEXT NOT NULL DEFAULT 'Standard';

COMMIT;
