ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS run_kind text NOT NULL DEFAULT 'implementation',
  ADD COLUMN IF NOT EXISTS parent_run_id uuid,
  ADD COLUMN IF NOT EXISTS review_cycle integer,
  ADD COLUMN IF NOT EXISTS review_id bigint,
  ADD COLUMN IF NOT EXISTS review_instructions text,
  ADD COLUMN IF NOT EXISTS review_comment_ids jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS pull_request_base_branch text,
  ADD COLUMN IF NOT EXISTS tenki_review_required boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='agent_runs_run_kind_check'
       AND conrelid='agent_runs'::regclass
  ) THEN
    ALTER TABLE agent_runs
      ADD CONSTRAINT agent_runs_run_kind_check
      CHECK (run_kind IN ('implementation','tenki_review_remediation'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='agent_runs_review_cycle_check'
       AND conrelid='agent_runs'::regclass
  ) THEN
    ALTER TABLE agent_runs
      ADD CONSTRAINT agent_runs_review_cycle_check
      CHECK (review_cycle IS NULL OR review_cycle BETWEEN 1 AND 20);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='agent_runs_parent_run_fk'
       AND conrelid='agent_runs'::regclass
  ) THEN
    ALTER TABLE agent_runs
      ADD CONSTRAINT agent_runs_parent_run_fk
      FOREIGN KEY (org_id,parent_run_id)
      REFERENCES agent_runs(org_id,id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS tenki_pr_review_cycles (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  root_run_id uuid NOT NULL,
  remediation_run_id uuid,
  repository text NOT NULL,
  pull_request_number integer NOT NULL CHECK (pull_request_number > 0),
  review_id bigint NOT NULL CHECK (review_id > 0),
  cycle integer NOT NULL CHECK (cycle BETWEEN 1 AND 20),
  state text NOT NULL CHECK (state IN (
    'Correction queued','Correction running','Correction published',
    'Review requested','Approved','Blocked','Failed'
  )),
  reviewer_login text NOT NULL,
  review_body text NOT NULL DEFAULT '',
  comment_ids jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(comment_ids)='array'),
  head_sha_before text NOT NULL,
  head_sha_after text,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (org_id,problem_id)
    REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,root_run_id)
    REFERENCES agent_runs(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id,remediation_run_id)
    REFERENCES agent_runs(org_id,id) ON DELETE RESTRICT,
  UNIQUE (org_id,repository,pull_request_number,review_id),
  UNIQUE (org_id,remediation_run_id)
);

CREATE INDEX IF NOT EXISTS tenki_pr_review_cycles_pr_idx
  ON tenki_pr_review_cycles(org_id,repository,pull_request_number,cycle DESC);

CREATE INDEX IF NOT EXISTS agent_runs_review_parent_idx
  ON agent_runs(org_id,parent_run_id,review_cycle DESC)
  WHERE parent_run_id IS NOT NULL;
