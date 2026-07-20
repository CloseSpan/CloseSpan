ALTER TABLE feedback_items
  ADD COLUMN IF NOT EXISTS integration_id text,
  ADD COLUMN IF NOT EXISTS external_id text;

CREATE TABLE IF NOT EXISTS integration_webhook_secrets (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  secret_hint text NOT NULL,
  secret_fingerprint text NOT NULL,
  encrypted_secret text NOT NULL,
  secret_iv text NOT NULL,
  secret_auth_tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, integration_id),
  FOREIGN KEY (org_id, integration_id) REFERENCES integrations(org_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS feedback_items_external_dedup_idx
  ON feedback_items(org_id, integration_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  provider_delivery_id text NOT NULL,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, integration_id, provider_delivery_id),
  FOREIGN KEY (org_id, integration_id) REFERENCES integrations(org_id, id) ON DELETE CASCADE
);
