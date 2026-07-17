-- Support custom events (title/description/date/tickets) alongside team games. An event is a
-- game with kind='event' under a built-in "Custom Events" group.
ALTER TABLE games ADD COLUMN title TEXT;
ALTER TABLE games ADD COLUMN description TEXT;
ALTER TABLE games ADD COLUMN kind TEXT NOT NULL DEFAULT 'game';
