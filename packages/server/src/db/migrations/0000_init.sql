-- Initial schema for AIS Ticket Concierge.
-- This raw DDL is the source of truth (gives exact control over CHECK constraints
-- and the partial-unique integrity index). The Drizzle schema mirrors it for typed queries.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','sales_rep','employee')),
  is_active INTEGER NOT NULL DEFAULT 1,
  linked_contact_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_refresh_user ON refresh_tokens(user_id);

CREATE TABLE teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  abbreviation TEXT NOT NULL,
  sport TEXT,
  venue TEXT,
  home_games_per_season INTEGER NOT NULL DEFAULT 0,
  default_platform TEXT NOT NULL DEFAULT 'mock',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_date INTEGER NOT NULL,
  end_date INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_season_team_label ON seasons(team_id, label);

CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  game_date INTEGER NOT NULL,
  opponent TEXT NOT NULL,
  promotions TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','transfer_pending','completed','cancelled')),
  total_seats INTEGER NOT NULL DEFAULT 0,
  premium_score REAL NOT NULL DEFAULT 0.5,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_game_season_date_opp ON games(season_id, game_date, opponent);
CREATE INDEX ix_game_season_date ON games(season_id, game_date);

CREATE TABLE seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  row TEXT NOT NULL,
  seat_number TEXT NOT NULL,
  is_ada INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','held','assigned','transferred','cancelled')),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_seat_identity ON seats(game_id, section, row, seat_number);
CREATE INDEX ix_seat_game_status ON seats(game_id, status);

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('customer','employee')),
  full_name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  title TEXT,
  account_owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  value_tier TEXT NOT NULL DEFAULT 'prospect' CHECK (value_tier IN ('platinum','gold','silver','bronze','prospect')),
  lifetime_business_generated REAL NOT NULL DEFAULT 0,
  last_ticket_date INTEGER,
  no_show_count INTEGER NOT NULL DEFAULT 0,
  attended_count INTEGER NOT NULL DEFAULT 0,
  awarded_count INTEGER NOT NULL DEFAULT 0,
  future_priority_flag TEXT NOT NULL DEFAULT 'normal' CHECK (future_priority_flag IN ('elevated','normal','deprioritized')),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_contact_type ON contacts(type);
CREATE INDEX ix_contact_owner ON contacts(account_owner_user_id);

CREATE TABLE ticket_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  requester_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requester_name TEXT,
  requester_company TEXT,
  requester_phone TEXT,
  requester_email TEXT,
  beneficiary_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  beneficiary_type TEXT NOT NULL DEFAULT 'customer' CHECK (beneficiary_type IN ('customer','employee')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  notes TEXT,
  sales_opportunity_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN
    ('submitted','scored','recommended','approved','partially_fulfilled','fulfilled','waitlisted','declined','cancelled')),
  priority_score REAL,
  priority_rank INTEGER,
  scoring_breakdown TEXT,
  scoring_config_id INTEGER REFERENCES scoring_configs(id) ON DELETE SET NULL,
  narrative TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','email_intake')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_request_game_status ON ticket_requests(game_id, status);

CREATE TABLE assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES ticket_requests(id) ON DELETE CASCADE,
  seat_id INTEGER NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  beneficiary_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','transferred','declined','cancelled')),
  assigned_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at INTEGER,
  transfer_ref TEXT,
  transfer_platform TEXT,
  transferred_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- INTEGRITY GUARANTEE: a seat can have at most ONE active assignment.
-- Two concurrent approvals of the same seat -> the second INSERT violates this -> 409.
CREATE UNIQUE INDEX uq_seat_active_assignment
  ON assignments(seat_id)
  WHERE status IN ('proposed','approved','transferred');
CREATE INDEX ix_assignment_game_status ON assignments(game_id, status);
CREATE INDEX ix_assignment_request ON assignments(request_id);

CREATE TABLE waitlist_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  request_id INTEGER NOT NULL REFERENCES ticket_requests(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','promoted','expired','cancelled')),
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- One active waitlist entry per request per game.
CREATE UNIQUE INDEX uq_waitlist_active ON waitlist_entries(game_id, request_id) WHERE status = 'active';
CREATE INDEX ix_waitlist_game_pos ON waitlist_entries(game_id, position);

CREATE TABLE attendance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL UNIQUE REFERENCES assignments(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  ticket_status TEXT NOT NULL CHECK (ticket_status IN ('accepted','declined','no_show','attended')),
  designation TEXT NOT NULL CHECK (designation IN ('customer','employee')),
  sales_rep_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  business_generated REAL NOT NULL DEFAULT 0,
  follow_up_notes TEXT,
  future_priority TEXT NOT NULL DEFAULT 'normal' CHECK (future_priority IN ('elevated','normal','deprioritized')),
  recorded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_attendance_game ON attendance_records(game_id);
CREATE INDEX ix_attendance_contact ON attendance_records(contact_id);

CREATE TABLE scoring_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  weights TEXT NOT NULL,
  params TEXT NOT NULL,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
-- At most one active scoring config.
CREATE UNIQUE INDEX uq_scoring_active ON scoring_configs(is_active) WHERE is_active = 1;

CREATE TABLE integration_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adapter TEXT NOT NULL CHECK (adapter IN ('ticketing','email_intake','narrative','schedule_import')),
  operation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success','error','skipped')),
  request_ref TEXT,
  payload TEXT,
  response TEXT,
  error TEXT,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_intlog_adapter_created ON integration_logs(adapter, created_at);
