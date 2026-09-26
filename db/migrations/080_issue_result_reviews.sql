-- Human observations about an exact implementation result, separate from
-- requirement acceptance, trusted Tenki reviews, and merge/deploy authority.
CREATE TABLE IF NOT EXISTS issue_result_reviews (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  run_id uuid NOT NULL,
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[a-f0-9]{40,64}$'),
  prompt_hash text NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  version integer NOT NULL CHECK (version > 0),
  decision text NOT NULL CHECK (decision IN ('accept','changes')),
  feedback text NOT NULL DEFAULT '' CHECK (length(feedback) <= 4000),
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decision <> 'changes' OR length(btrim(feedback)) > 0),
  FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,run_id) REFERENCES agent_runs(org_id,id) ON DELETE RESTRICT,
  UNIQUE (org_id,problem_id,version),
  UNIQUE (org_id,problem_id,actor_id,idempotency_key)
);

CREATE INDEX IF NOT EXISTS issue_result_reviews_binding_idx
  ON issue_result_reviews(org_id,problem_id,run_id,commit_sha,prompt_hash,version DESC);
