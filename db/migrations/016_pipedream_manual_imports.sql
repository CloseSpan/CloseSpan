ALTER TABLE pipedream_connections
  ADD COLUMN IF NOT EXISTS last_import_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_import_status text,
  ADD COLUMN IF NOT EXISTS last_import_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_import_error text;

ALTER TABLE pipedream_connections
  DROP CONSTRAINT IF EXISTS pipedream_connections_last_import_status_check;
ALTER TABLE pipedream_connections
  ADD CONSTRAINT pipedream_connections_last_import_status_check
  CHECK (last_import_status IS NULL OR last_import_status IN ('Running','Succeeded','Failed'));

ALTER TABLE pipedream_connections
  DROP CONSTRAINT IF EXISTS pipedream_connections_last_import_count_check;
ALTER TABLE pipedream_connections
  ADD CONSTRAINT pipedream_connections_last_import_count_check
  CHECK (last_import_count >= 0);
