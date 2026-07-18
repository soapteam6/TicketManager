-- Capture the Dynamics account owner (the rep who owns the customer) on each request.
ALTER TABLE ticket_requests ADD COLUMN account_owner TEXT;
