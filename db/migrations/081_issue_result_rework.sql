ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_run_kind_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_run_kind_check
  CHECK (run_kind IN ('implementation','tenki_review_remediation','domain_result_rework'));
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS result_review_id uuid;
ALTER TABLE issue_result_reviews ADD CONSTRAINT issue_result_reviews_org_id_id_key UNIQUE (org_id,id);
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_result_review_fk
  FOREIGN KEY (org_id,result_review_id) REFERENCES issue_result_reviews(org_id,id) ON DELETE RESTRICT;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_domain_result_rework_binding_check
  CHECK (run_kind <> 'domain_result_rework' OR
    (result_review_id IS NOT NULL AND parent_run_id IS NOT NULL AND review_id IS NULL
      AND review_cycle IS NULL AND review_instructions IS NOT NULL AND pull_request_number IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_result_review_once_idx
  ON agent_runs(org_id,result_review_id) WHERE result_review_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS issue_result_rework_requests (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  review_id uuid NOT NULL,
  source_run_id uuid NOT NULL,
  run_id uuid NOT NULL,
  approval_id text NOT NULL,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,review_id) REFERENCES issue_result_reviews(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id,source_run_id) REFERENCES agent_runs(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id,run_id) REFERENCES agent_runs(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id,approval_id) REFERENCES approval_requests(org_id,id) ON DELETE RESTRICT,
  UNIQUE (org_id,problem_id,actor_id,idempotency_key),
  UNIQUE (org_id,review_id),
  UNIQUE (org_id,run_id)
);
