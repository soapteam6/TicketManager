-- Seat reservations: offer a seat to a named person with a deadline to confirm. The partial
-- unique index guarantees a seat can only be actively offered/reserved once at a time.
CREATE TABLE reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seat_id INTEGER NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  person_name TEXT NOT NULL,
  person_email TEXT,
  ticket_type TEXT,
  status TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','reserved','expired','released')),
  expires_at INTEGER NOT NULL,
  reserved_at INTEGER,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_reservation_active_seat ON reservations(seat_id) WHERE status IN ('offered','reserved');
CREATE INDEX ix_reservation_game_status ON reservations(game_id, status);
