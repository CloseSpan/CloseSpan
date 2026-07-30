CREATE TABLE IF NOT EXISTS github_app_install_attempts (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS github_app_installations (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  installation_id bigint NOT NULL UNIQUE,
  account_id bigint NOT NULL,
  account_login text NOT NULL,
  account_type text NOT NULL,
  repository_selection text NOT NULL,
  settings_url text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id,installation_id)
);

CREATE INDEX IF NOT EXISTS github_install_attempts_expiry_idx
  ON github_app_install_attempts(expires_at)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS github_installations_org_active_idx
  ON github_app_installations(org_id,active,updated_at DESC);

CREATE INDEX IF NOT EXISTS github_allowlists_installation_idx
  ON github_repository_allowlists(org_id,installation_id,active);
