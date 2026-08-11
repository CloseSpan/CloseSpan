ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS agent_run_id uuid,
  ADD COLUMN IF NOT EXISTS pull_request_number integer,
  ADD COLUMN IF NOT EXISTS pull_request_url text,
  ADD COLUMN IF NOT EXISTS head_sha text,
  ADD COLUMN IF NOT EXISTS target_environment text;

ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_agent_run_fk
  FOREIGN KEY (org_id,agent_run_id)
  REFERENCES agent_runs(org_id,id) ON DELETE RESTRICT;

ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_final_execution_binding_check
  CHECK (
    action_type <> 'final_execution'
    OR (
      agent_run_id IS NOT NULL
      AND pull_request_number IS NOT NULL
      AND pull_request_number > 0
      AND pull_request_url IS NOT NULL
      AND head_sha ~ '^[a-f0-9]{40,64}$'
      AND repository IS NOT NULL
      AND base_branch IS NOT NULL
      AND expires_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS final_execution_approval_run_idx
  ON approval_requests(org_id,agent_run_id)
  WHERE action_type='final_execution';

CREATE TABLE IF NOT EXISTS final_execution_attempts (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  approval_id text NOT NULL,
  agent_run_id uuid NOT NULL,
  action text NOT NULL DEFAULT 'merge_pull_request'
    CHECK (action IN ('merge_pull_request','deploy')),
  status text NOT NULL
    CHECK (status IN ('Queued','Running','Succeeded','Failed')),
  repository text NOT NULL,
  pull_request_number integer NOT NULL CHECK (pull_request_number > 0),
  expected_head_sha text NOT NULL CHECK (expected_head_sha ~ '^[a-f0-9]{40,64}$'),
  result_sha text,
  result_url text,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY (org_id,approval_id)
    REFERENCES approval_requests(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id,agent_run_id)
    REFERENCES agent_runs(org_id,id) ON DELETE RESTRICT,
  UNIQUE (org_id,approval_id),
  UNIQUE (org_id,id)
);

CREATE INDEX IF NOT EXISTS final_execution_attempts_run_idx
  ON final_execution_attempts(org_id,agent_run_id,created_at DESC);
