-- Non-destructive: existing allocations and requests remain; public access starts private.
ALTER TABLE games ADD COLUMN release_status TEXT NOT NULL DEFAULT 'private' CHECK (release_status IN ('private','released','scheduled'));
ALTER TABLE games ADD COLUMN release_at INTEGER;
ALTER TABLE contacts ADD COLUMN directory_active INTEGER NOT NULL DEFAULT 1;
CREATE INDEX ix_game_release ON games(release_status, release_at);
CREATE TABLE review_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE mock_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, audience TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE allocation_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL REFERENCES ticket_requests(id), user_id INTEGER REFERENCES users(id), reason TEXT NOT NULL, created_at INTEGER NOT NULL);
