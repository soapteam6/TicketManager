-- Team official website (for AI schedule import) and a default number of available tickets per game.
ALTER TABLE teams ADD COLUMN official_url TEXT;
ALTER TABLE teams ADD COLUMN default_tickets_per_game INTEGER NOT NULL DEFAULT 0;
