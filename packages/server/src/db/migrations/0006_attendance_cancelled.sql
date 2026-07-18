-- Allow 'cancelled' as an attendance outcome. SQLite can't ALTER a CHECK constraint, so
-- rebuild attendance_records with the widened ticket_status check and copy the data over.
PRAGMA foreign_keys=OFF;

CREATE TABLE attendance_records_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL UNIQUE REFERENCES assignments(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  ticket_status TEXT NOT NULL CHECK (ticket_status IN ('accepted','declined','no_show','attended','cancelled')),
  designation TEXT NOT NULL CHECK (designation IN ('customer','employee')),
  sales_rep_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  business_generated REAL NOT NULL DEFAULT 0,
  follow_up_notes TEXT,
  future_priority TEXT NOT NULL DEFAULT 'normal' CHECK (future_priority IN ('elevated','normal','deprioritized')),
  recorded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO attendance_records_new
SELECT id, assignment_id, game_id, contact_id, ticket_status, designation, sales_rep_user_id,
       business_generated, follow_up_notes, future_priority, recorded_by_user_id, created_at, updated_at
FROM attendance_records;

DROP TABLE attendance_records;
ALTER TABLE attendance_records_new RENAME TO attendance_records;

CREATE INDEX ix_attendance_game ON attendance_records(game_id);
CREATE INDEX ix_attendance_contact ON attendance_records(contact_id);

PRAGMA foreign_keys=ON;
