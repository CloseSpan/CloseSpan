CREATE TABLE IF NOT EXISTS issue_runtime_verification_runs (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  investigation_id text NOT NULL,
  repository text NOT NULL,
  installation_id bigint NOT NULL,
  workspace_root text NOT NULL DEFAULT '.',
  base_branch text NOT NULL,
  base_sha text NOT NULL CHECK (base_sha ~ '^[a-f0-9]{40}$'),
  prompt_hash text NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  verification_prompt text NOT NULL,
  execution_profile_id uuid NOT NULL,
  execution_profile_hash text NOT NULL CHECK (execution_profile_hash ~ '^[a-f0-9]{64}$'),
  execution_profile_snapshot jsonb NOT NULL CHECK (jsonb_typeof(execution_profile_snapshot)='object'),
  workflow_hash text NOT NULL CHECK (workflow_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'Queued'
    CHECK (status IN ('Queued','Running','Completed','Failed')),
  outcome text
    CHECK (outcome IS NULL OR outcome IN ('Confirmed current','Not reproduced','Verification blocked')),
  summary text,
  report jsonb CHECK (report IS NULL OR jsonb_typeof(report)='object'),
  failure_message text,
  workflow_run_id bigint,
  requested_by text NOT NULL,
  requested_by_name text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id,id),
  FOREIGN KEY (org_id,problem_id)
    REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,investigation_id)
    REFERENCES investigations(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,execution_profile_id,execution_profile_hash)
    REFERENCES execution_profile_versions(org_id,id,content_hash)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX IF NOT EXISTS issue_runtime_verification_one_active_idx
  ON issue_runtime_verification_runs(org_id,problem_id)
  WHERE status IN ('Queued','Running');

CREATE INDEX IF NOT EXISTS issue_runtime_verification_problem_idx
  ON issue_runtime_verification_runs(org_id,problem_id,requested_at DESC);
