ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS execution_action text NOT NULL DEFAULT 'merge_pull_request',
  ADD COLUMN IF NOT EXISTS auto_deploy_on_merge boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rollback_plan text;

ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_execution_action_check
  CHECK (execution_action IN ('merge_pull_request','deploy'));

CREATE TABLE IF NOT EXISTS release_events (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  delivery_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'github',
  agent_run_id uuid NOT NULL,
  problem_id text NOT NULL,
  environment text NOT NULL,
  status text NOT NULL CHECK (status IN ('Pending','Running','Succeeded','Failed')),
  deployment_sha text,
  deployment_url text,
  description text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,agent_run_id) REFERENCES agent_runs(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  UNIQUE (org_id,provider,delivery_id),
  UNIQUE (org_id,id)
);

CREATE INDEX IF NOT EXISTS release_events_problem_idx
  ON release_events(org_id,problem_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS post_release_verification_jobs (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  release_event_id uuid NOT NULL,
  agent_run_id uuid NOT NULL,
  problem_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('Queued','Running','Passed','Failed')),
  environment text NOT NULL,
  deployment_sha text,
  verification_instructions text NOT NULL,
  evidence text,
  failure_message text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY (org_id,release_event_id) REFERENCES release_events(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id,agent_run_id) REFERENCES agent_runs(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  UNIQUE (org_id,release_event_id),
  UNIQUE (org_id,id)
);

CREATE INDEX IF NOT EXISTS post_release_verification_jobs_queue_idx
  ON post_release_verification_jobs(status,queued_at)
  WHERE status IN ('Queued','Running');

UPDATE approval_requests approval
SET evidence_snapshot = jsonb_build_object(
      'schemaVersion', 1,
      'agentRunId', run.id,
      'repository', approval.repository,
      'baseBranch', approval.base_branch,
      'pullRequestNumber', approval.pull_request_number,
      'pullRequestUrl', approval.pull_request_url,
      'headSha', approval.head_sha,
      'changedFiles', run.changed_files,
      'tests', run.test_results,
      'implementationReport', run.implementation_report
    )
FROM agent_runs run
WHERE approval.org_id=run.org_id
  AND approval.agent_run_id=run.id
  AND approval.action_type='final_execution'
  AND approval.evidence_snapshot='{}'::jsonb;
