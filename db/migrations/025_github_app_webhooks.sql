CREATE TABLE IF NOT EXISTS github_webhook_deliveries (
  delivery_id uuid PRIMARY KEY,
  event text NOT NULL,
  action text,
  installation_id bigint,
  org_id text REFERENCES organizations(id) ON DELETE SET NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  outcome text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS github_webhook_deliveries_org_time_idx
  ON github_webhook_deliveries(org_id,received_at DESC);

CREATE INDEX IF NOT EXISTS github_webhook_deliveries_installation_time_idx
  ON github_webhook_deliveries(installation_id,received_at DESC)
  WHERE installation_id IS NOT NULL;
