-- Support multiple beneficiary contacts per request (all from the same company) and
-- record the CRM opportunity that supplied the revenue (Manual Rep Credit).

ALTER TABLE ticket_requests ADD COLUMN crm_opportunity_id TEXT;
ALTER TABLE ticket_requests ADD COLUMN crm_opportunity_name TEXT;

CREATE TABLE request_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES ticket_requests(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_request_contact ON request_contacts(request_id, contact_id);
CREATE INDEX ix_request_contacts_req ON request_contacts(request_id);
