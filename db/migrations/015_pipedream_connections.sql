CREATE TABLE IF NOT EXISTS pipedream_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  external_user_id text NOT NULL,
  account_id text NOT NULL,
  app_slug text NOT NULL,
  account_name text,
  state text NOT NULL DEFAULT 'Connected'
    CHECK (state IN ('Connected','Needs reconnect','Disconnected')),
  healthy boolean,
  authorized_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  connected_by text NOT NULL,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, integration_id, account_id),
  UNIQUE (account_id),
  FOREIGN KEY (org_id, integration_id)
    REFERENCES integrations(org_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pipedream_connections_org_state_idx
  ON pipedream_connections(org_id, state, updated_at DESC);

-- Retain legacy connector data for audit/history, but stop treating it as an
-- active credential path after this migration.
UPDATE integration_connections SET state='Disconnected', updated_at=now()
WHERE state <> 'Disconnected';

UPDATE integrations SET connection_state='Not connected', data_scope='None',
  permissions='[]'::jsonb, error_message=NULL
WHERE id IN (
  'int_zendesk','int_intercom','int_slack','int_app_store','int_play_store',
  'int_github','int_linear','int_jira','int_sentry','int_posthog'
);
