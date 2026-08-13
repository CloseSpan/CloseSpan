CREATE TABLE IF NOT EXISTS tenki_runner_workflow_setups (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repository text NOT NULL,
  workflow_path text NOT NULL,
  pull_request_number integer,
  pull_request_url text,
  status text NOT NULL CHECK (status IN ('Pending','Installed')),
  merged_sha text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id,repository),
  CHECK (
    status='Installed'
    OR (pull_request_number IS NOT NULL AND pull_request_number > 0 AND pull_request_url IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS tenki_runner_workflow_setups_pending_idx
  ON tenki_runner_workflow_setups(org_id,status,updated_at DESC);
