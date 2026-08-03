CREATE TABLE IF NOT EXISTS pdd_prompt_verifications (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  prompt_revision_id uuid NOT NULL,
  prompt_hash text NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  user_story text NOT NULL,
  story_hash text NOT NULL CHECK (story_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN (
    'Queued','Generating tests','Ready for approval','Failed','Superseded'
  )),
  pdd_version text NOT NULL,
  model text,
  budget_usd numeric(8,4) NOT NULL CHECK (budget_usd > 0 AND budget_usd <= 100),
  cost_usd numeric(8,4) CHECK (cost_usd >= 0 AND cost_usd <= 100),
  summary text,
  generated_tests jsonb NOT NULL DEFAULT '[]',
  failure_message text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY (org_id,problem_id)
    REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,prompt_revision_id)
    REFERENCES implementation_prompts(org_id,id) ON DELETE RESTRICT,
  UNIQUE (org_id,prompt_revision_id,story_hash),
  UNIQUE (org_id,id)
);

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS pdd_verification_id uuid;

ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_pdd_verification_fk
  FOREIGN KEY (org_id,pdd_verification_id)
  REFERENCES pdd_prompt_verifications(org_id,id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS pdd_prompt_verifications_problem_idx
  ON pdd_prompt_verifications(org_id,problem_id,created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS pdd_prompt_verifications_active_idx
  ON pdd_prompt_verifications(org_id,problem_id)
  WHERE status IN ('Queued','Generating tests','Ready for approval');
