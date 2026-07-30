CREATE TABLE IF NOT EXISTS workflow_automation_leases (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  last_transition_at timestamptz NOT NULL,
  problem_id text NOT NULL,
  from_stage text NOT NULL,
  to_stage text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_automation_transition_idx
  ON workflow_automation_leases(last_transition_at DESC);
