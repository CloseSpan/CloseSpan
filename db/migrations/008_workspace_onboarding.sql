CREATE TABLE IF NOT EXISTS workspace_onboarding (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  phase text NOT NULL DEFAULT 'discover',
  product_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_connectors jsonb NOT NULL DEFAULT '[]'::jsonb,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
