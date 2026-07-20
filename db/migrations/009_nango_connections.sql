-- Normalize connector identifiers introduced before the shared integration catalog.
-- Canonical rows are created first so dependent records can be moved without
-- temporarily breaking their composite foreign keys.
UPDATE integrations
SET provider = 'Apple App Store (legacy int_appstore)'
WHERE id = 'int_appstore' AND provider = 'Apple App Store';

UPDATE integrations
SET provider = 'Google Play Store (legacy int_play)'
WHERE id = 'int_play' AND provider = 'Google Play Store';

INSERT INTO integrations(
  id, org_id, provider, category, connection_state, last_sync_at,
  data_scope, permissions, error_message, display_order
)
SELECT
  'int_app_store', org_id, 'Apple App Store', 'Reviews', connection_state,
  last_sync_at, data_scope, permissions, error_message, 4
FROM integrations
WHERE id = 'int_appstore'
ON CONFLICT DO NOTHING;

INSERT INTO integrations(
  id, org_id, provider, category, connection_state, last_sync_at,
  data_scope, permissions, error_message, display_order
)
SELECT
  'int_play_store', org_id, 'Google Play Store', 'Reviews', connection_state,
  last_sync_at, data_scope, permissions, error_message, 5
FROM integrations
WHERE id = 'int_play'
ON CONFLICT DO NOTHING;

DELETE FROM integration_webhook_secrets legacy
USING integration_webhook_secrets canonical
WHERE legacy.org_id = canonical.org_id
  AND legacy.integration_id = 'int_appstore'
  AND canonical.integration_id = 'int_app_store';

DELETE FROM integration_webhook_secrets legacy
USING integration_webhook_secrets canonical
WHERE legacy.org_id = canonical.org_id
  AND legacy.integration_id = 'int_play'
  AND canonical.integration_id = 'int_play_store';

UPDATE integration_webhook_secrets
SET integration_id = 'int_app_store'
WHERE integration_id = 'int_appstore';

UPDATE integration_webhook_secrets
SET integration_id = 'int_play_store'
WHERE integration_id = 'int_play';

DELETE FROM webhook_deliveries legacy
USING webhook_deliveries canonical
WHERE legacy.org_id = canonical.org_id
  AND legacy.integration_id = 'int_appstore'
  AND canonical.integration_id = 'int_app_store'
  AND legacy.provider_delivery_id = canonical.provider_delivery_id;

DELETE FROM webhook_deliveries legacy
USING webhook_deliveries canonical
WHERE legacy.org_id = canonical.org_id
  AND legacy.integration_id = 'int_play'
  AND canonical.integration_id = 'int_play_store'
  AND legacy.provider_delivery_id = canonical.provider_delivery_id;

UPDATE webhook_deliveries
SET integration_id = 'int_app_store'
WHERE integration_id = 'int_appstore';

UPDATE webhook_deliveries
SET integration_id = 'int_play_store'
WHERE integration_id = 'int_play';

-- Preserve both feedback records if legacy and canonical connector rows used
-- the same external identifier. Clearing only the legacy duplicate's external
-- key avoids violating feedback_items_external_dedup_idx during normalization.
UPDATE feedback_items legacy
SET external_id = NULL
FROM feedback_items canonical
WHERE legacy.org_id = canonical.org_id
  AND legacy.id <> canonical.id
  AND legacy.integration_id = 'int_appstore'
  AND canonical.integration_id = 'int_app_store'
  AND legacy.external_id IS NOT NULL
  AND legacy.external_id = canonical.external_id;

UPDATE feedback_items legacy
SET external_id = NULL
FROM feedback_items canonical
WHERE legacy.org_id = canonical.org_id
  AND legacy.id <> canonical.id
  AND legacy.integration_id = 'int_play'
  AND canonical.integration_id = 'int_play_store'
  AND legacy.external_id IS NOT NULL
  AND legacy.external_id = canonical.external_id;

UPDATE feedback_items
SET integration_id = 'int_app_store'
WHERE integration_id = 'int_appstore';

UPDATE feedback_items
SET integration_id = 'int_play_store'
WHERE integration_id = 'int_play';

DELETE FROM integrations WHERE id IN ('int_appstore', 'int_play');

UPDATE integrations
SET provider = 'Apple App Store', category = 'Reviews', display_order = 4
WHERE id = 'int_app_store';

UPDATE integrations
SET provider = 'Google Play Store', category = 'Reviews', display_order = 5
WHERE id = 'int_play_store';

CREATE TABLE IF NOT EXISTS integration_connection_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  provider_config_key text NOT NULL CHECK (
    char_length(provider_config_key) BETWEEN 1 AND 255
  ),
  nango_environment text NOT NULL CHECK (
    nango_environment ~ '^[A-Z0-9][A-Z0-9_-]{0,79}$'
  ),
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  actor_email text NOT NULL,
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 128
  ),
  state text NOT NULL DEFAULT 'Pending' CHECK (
    state IN ('Pending', 'Connected', 'Failed', 'Expired')
  ),
  expires_at timestamptz NOT NULL,
  error_code text CHECK (
    error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 80
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, integration_id, id),
  FOREIGN KEY (org_id, integration_id)
    REFERENCES integrations(org_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS nango_attempts_one_pending_idx
  ON integration_connection_attempts(org_id, integration_id)
  WHERE state = 'Pending';

CREATE INDEX IF NOT EXISTS nango_attempts_org_created_idx
  ON integration_connection_attempts(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  attempt_id uuid NOT NULL,
  provider_config_key text NOT NULL CHECK (
    char_length(provider_config_key) BETWEEN 1 AND 255
  ),
  connection_id text NOT NULL CHECK (
    char_length(connection_id) BETWEEN 1 AND 255
  ),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 255),
  nango_environment text NOT NULL CHECK (
    nango_environment ~ '^[A-Z0-9][A-Z0-9_-]{0,79}$'
  ),
  state text NOT NULL DEFAULT 'Connected' CHECK (
    state IN ('Connected', 'Needs reconnect', 'Disconnected')
  ),
  connected_by text NOT NULL,
  last_sync_status text NOT NULL DEFAULT 'Never' CHECK (
    last_sync_status IN ('Never', 'Running', 'Success', 'Failed')
  ),
  last_sync_at timestamptz,
  last_error_code text CHECK (
    last_error_code IS NULL OR char_length(last_error_code) BETWEEN 1 AND 80
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, integration_id),
  UNIQUE (attempt_id),
  UNIQUE (nango_environment, provider_config_key, connection_id),
  FOREIGN KEY (org_id, integration_id)
    REFERENCES integrations(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, integration_id, attempt_id)
    REFERENCES integration_connection_attempts(org_id, integration_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS nango_connections_org_state_idx
  ON integration_connections(org_id, state);

CREATE TABLE IF NOT EXISTS nango_webhook_events (
  payload_hash text PRIMARY KEY CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 80),
  operation text CHECK (
    operation IS NULL OR char_length(operation) BETWEEN 1 AND 80
  ),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  provider_config_key text NOT NULL,
  connection_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  outcome text NOT NULL DEFAULT 'Processing' CHECK (
    outcome IN ('Processing', 'Processed', 'Ignored')
  ),
  FOREIGN KEY (org_id, integration_id)
    REFERENCES integrations(org_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS nango_webhook_events_org_received_idx
  ON nango_webhook_events(org_id, received_at DESC);
