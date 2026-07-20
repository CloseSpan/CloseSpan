-- Durable Nango record ingestion. Webhooks enqueue work and return quickly;
-- workers lease jobs, persist each page atomically, and resume from the
-- stream cursor after retries or later sync notifications.
CREATE TABLE IF NOT EXISTS nango_sync_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  provider_config_key text NOT NULL CHECK (
    char_length(provider_config_key) BETWEEN 1 AND 255
  ),
  connection_id text NOT NULL CHECK (
    char_length(connection_id) BETWEEN 1 AND 255
  ),
  nango_environment text NOT NULL CHECK (
    nango_environment ~ '^[A-Z0-9][A-Z0-9_-]{0,79}$'
  ),
  sync_name text NOT NULL CHECK (char_length(sync_name) BETWEEN 1 AND 255),
  sync_variant text NOT NULL DEFAULT '' CHECK (char_length(sync_variant) <= 255),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 255),
  cursor text,
  source_modified_after text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id, integration_id),
  UNIQUE (
    org_id, integration_id, provider_config_key, connection_id,
    nango_environment, sync_name, sync_variant, model
  ),
  FOREIGN KEY (org_id, integration_id)
    REFERENCES integrations(org_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS nango_sync_cursors_connection_idx
  ON nango_sync_cursors(
    nango_environment, provider_config_key, connection_id, updated_at DESC
  );

CREATE UNIQUE INDEX IF NOT EXISTS nango_webhook_events_tenant_hash_idx
  ON nango_webhook_events(payload_hash, org_id, integration_id);

CREATE TABLE IF NOT EXISTS nango_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cursor_id uuid NOT NULL,
  webhook_event_hash text NOT NULL UNIQUE,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  status text NOT NULL DEFAULT 'Queued' CHECK (
    status IN ('Queued', 'Running', 'Retrying', 'Succeeded', 'Failed')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 32),
  records_processed integer NOT NULL DEFAULT 0 CHECK (records_processed >= 0),
  pages_processed integer NOT NULL DEFAULT 0 CHECK (pages_processed >= 0),
  cursor text,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_by text CHECK (
    locked_by IS NULL OR char_length(locked_by) BETWEEN 1 AND 160
  ),
  lease_expires_at timestamptz,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text CHECK (
    last_error_code IS NULL OR char_length(last_error_code) BETWEEN 1 AND 80
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cursor_id, org_id, integration_id)
    REFERENCES nango_sync_cursors(id, org_id, integration_id)
    ON DELETE CASCADE,
  FOREIGN KEY (webhook_event_hash, org_id, integration_id)
    REFERENCES nango_webhook_events(payload_hash, org_id, integration_id)
    ON DELETE CASCADE,
  FOREIGN KEY (org_id, integration_id)
    REFERENCES integrations(org_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS nango_sync_jobs_claim_idx
  ON nango_sync_jobs(status, available_at, queued_at)
  WHERE status IN ('Queued', 'Retrying', 'Running');

CREATE INDEX IF NOT EXISTS nango_sync_jobs_org_integration_idx
  ON nango_sync_jobs(org_id, integration_id, queued_at DESC);

CREATE TABLE IF NOT EXISTS nango_sync_record_receipts (
  cursor_id uuid NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  external_id text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 512),
  nango_cursor text,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  last_action text NOT NULL CHECK (
    last_action IN ('ADDED', 'UPDATED', 'DELETED')
  ),
  outcome text NOT NULL CHECK (
    outcome IN ('Ingested', 'Deleted', 'Skipped')
  ),
  feedback_id text,
  first_processed_at timestamptz NOT NULL DEFAULT now(),
  last_processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cursor_id, external_id),
  FOREIGN KEY (cursor_id, org_id, integration_id)
    REFERENCES nango_sync_cursors(id, org_id, integration_id)
    ON DELETE CASCADE,
  FOREIGN KEY (org_id, integration_id)
    REFERENCES integrations(org_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS nango_sync_record_receipts_feedback_idx
  ON nango_sync_record_receipts(org_id, feedback_id)
  WHERE feedback_id IS NOT NULL;
