-- Dynamics 365 CRM integration: link contacts to CRM records and allow the 'crm' adapter
-- value in integration_logs (SQLite can't alter a CHECK in place, so rebuild the table).

ALTER TABLE contacts ADD COLUMN crm_contact_id TEXT;
ALTER TABLE contacts ADD COLUMN crm_account_id TEXT;
CREATE INDEX ix_contact_crm ON contacts(crm_contact_id);

CREATE TABLE integration_logs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adapter TEXT NOT NULL CHECK (adapter IN ('ticketing','email_intake','narrative','schedule_import','crm')),
  operation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success','error','skipped')),
  request_ref TEXT,
  payload TEXT,
  response TEXT,
  error TEXT,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);
INSERT INTO integration_logs_new (id, adapter, operation, status, request_ref, payload, response, error, duration_ms, created_at)
  SELECT id, adapter, operation, status, request_ref, payload, response, error, duration_ms, created_at FROM integration_logs;
DROP TABLE integration_logs;
ALTER TABLE integration_logs_new RENAME TO integration_logs;
CREATE INDEX ix_intlog_adapter_created ON integration_logs(adapter, created_at);
