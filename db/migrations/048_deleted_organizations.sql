CREATE TABLE IF NOT EXISTS deleted_organizations (
  organization_id text PRIMARY KEY,
  organization_name text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE deleted_organizations IS
  'Minimal tombstones for deleted organizations. No tenant, member, or integration data is retained.';
