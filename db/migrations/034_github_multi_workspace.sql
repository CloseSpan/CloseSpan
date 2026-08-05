-- A GitHub App installation belongs to a GitHub account, not to a single
-- CloseSpan workspace. Keep workspace bindings unique while allowing the same
-- installation to be explicitly connected to more than one workspace.
ALTER TABLE github_app_installations
  DROP CONSTRAINT IF EXISTS github_app_installations_installation_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS github_installations_org_installation_uidx
  ON github_app_installations(org_id,installation_id);

ALTER TABLE github_app_installations
  ADD COLUMN IF NOT EXISTS workspace_connected boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS github_installations_installation_active_idx
  ON github_app_installations(installation_id,workspace_connected,active,org_id);

-- Keep workspace intent separate from current GitHub accessibility. A webhook
-- may make a selected repository inactive when GitHub removes access, but a
-- newly accessible repository must not be silently granted to every workspace.
ALTER TABLE github_repository_allowlists
  ADD COLUMN IF NOT EXISTS workspace_selected boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS github_allowlists_workspace_selection_idx
  ON github_repository_allowlists(org_id,installation_id,workspace_selected,active);

-- One GitHub delivery is deduplicated globally. This table records the result
-- for every workspace bound to that installation without duplicating the
-- delivery payload or weakening the global delivery-id idempotency boundary.
CREATE TABLE IF NOT EXISTS github_webhook_delivery_workspaces (
  delivery_id uuid NOT NULL
    REFERENCES github_webhook_deliveries(delivery_id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  outcome text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (delivery_id,org_id)
);

CREATE INDEX IF NOT EXISTS github_webhook_delivery_workspaces_org_time_idx
  ON github_webhook_delivery_workspaces(org_id,processed_at DESC);
