CREATE TABLE IF NOT EXISTS workspace_demo_guides (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(steps) = 'array')
);
