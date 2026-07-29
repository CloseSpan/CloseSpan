ALTER TABLE approval_requests
  DROP CONSTRAINT IF EXISTS approval_requests_status_check;

ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_status_check
  CHECK (status IN ('Pending','Approved','Rejected','Superseded','Expired'));

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS action_type text NOT NULL DEFAULT 'external_work_item',
  ADD COLUMN IF NOT EXISTS prompt_revision_id uuid,
  ADD COLUMN IF NOT EXISTS prompt_hash text,
  ADD COLUMN IF NOT EXISTS repository text,
  ADD COLUMN IF NOT EXISTS base_branch text,
  ADD COLUMN IF NOT EXISTS base_sha text,
  ADD COLUMN IF NOT EXISTS allowed_capabilities jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

CREATE TABLE IF NOT EXISTS engineering_ticket_specifications (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  implementation_state text NOT NULL DEFAULT 'Draft specification'
    CHECK (implementation_state IN (
      'Draft specification','Prompt ready','Awaiting approval','Running',
      'Tests passed','Draft PR opened','Released','Verified'
    )),
  user_story text NOT NULL,
  current_behavior text NOT NULL,
  expected_behavior text NOT NULL,
  reproduction_steps jsonb NOT NULL DEFAULT '[]',
  business_outcome text NOT NULL,
  regression_scenarios jsonb NOT NULL DEFAULT '[]',
  negative_scenarios jsonb NOT NULL DEFAULT '[]',
  quality_expectations jsonb NOT NULL DEFAULT '[]',
  required_test_levels jsonb NOT NULL DEFAULT '[]',
  release_verification text NOT NULL,
  non_goals jsonb NOT NULL DEFAULT '[]',
  permitted_paths jsonb NOT NULL DEFAULT '[]',
  required_commands jsonb NOT NULL DEFAULT '[]',
  repository text NOT NULL,
  base_branch text NOT NULL,
  base_sha text NOT NULL,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,problem_id)
    REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  UNIQUE (org_id,problem_id),
  UNIQUE (org_id,id)
);

CREATE TABLE IF NOT EXISTS engineering_acceptance_criteria (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  specification_id uuid NOT NULL,
  criterion_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  statement text NOT NULL,
  measurable boolean NOT NULL DEFAULT true,
  PRIMARY KEY (org_id,specification_id,criterion_id),
  UNIQUE (org_id,specification_id,ordinal),
  CHECK (criterion_id ~ '^AC-[1-9][0-9]*$'),
  FOREIGN KEY (org_id,specification_id)
    REFERENCES engineering_ticket_specifications(org_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS engineering_test_scenarios (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  specification_id uuid NOT NULL,
  scenario_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  title text NOT NULL,
  given_text text NOT NULL,
  when_text text NOT NULL,
  then_text text NOT NULL,
  test_level text NOT NULL CHECK (test_level IN ('unit','integration','api','component','end-to-end','manual')),
  criterion_ids jsonb NOT NULL,
  PRIMARY KEY (org_id,specification_id,scenario_id),
  UNIQUE (org_id,specification_id,ordinal),
  CHECK (scenario_id ~ '^TEST-[1-9][0-9]*$'),
  FOREIGN KEY (org_id,specification_id)
    REFERENCES engineering_ticket_specifications(org_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS implementation_prompts (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  specification_id uuid NOT NULL,
  specification_revision integer NOT NULL CHECK (specification_revision > 0),
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('Ready','Awaiting approval','Approved','Superseded')),
  repository text NOT NULL,
  base_branch text NOT NULL,
  base_sha text NOT NULL,
  artifact_path text NOT NULL,
  structured_snapshot jsonb NOT NULL,
  rendered_content text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,problem_id)
    REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,specification_id)
    REFERENCES engineering_ticket_specifications(org_id,id) ON DELETE RESTRICT,
  UNIQUE (org_id,problem_id,revision),
  UNIQUE (org_id,content_hash),
  UNIQUE (org_id,id)
);

ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_prompt_revision_fk
  FOREIGN KEY (org_id,prompt_revision_id) REFERENCES implementation_prompts(org_id,id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS github_repository_allowlists (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  installation_id bigint NOT NULL,
  repository text NOT NULL,
  default_branch text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id,repository)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  prompt_revision_id uuid NOT NULL,
  approval_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'Queued','Running','Tests passed','Draft PR opened','Failed','Cancelled','No changes'
  )),
  repository text NOT NULL,
  base_branch text NOT NULL,
  base_sha text NOT NULL,
  branch_name text NOT NULL,
  sandbox_id text,
  prompt_hash text NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  changed_files jsonb NOT NULL DEFAULT '[]',
  test_results jsonb NOT NULL DEFAULT '[]',
  implementation_report jsonb,
  failure_code text,
  failure_message text,
  prompt_commit_sha text,
  implementation_commit_sha text,
  pull_request_number integer,
  pull_request_url text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY (org_id,problem_id)
    REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,prompt_revision_id)
    REFERENCES implementation_prompts(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id,approval_id)
    REFERENCES approval_requests(org_id,id) ON DELETE RESTRICT,
  UNIQUE (org_id,approval_id),
  UNIQUE (org_id,id)
);

CREATE TABLE IF NOT EXISTS agent_run_criterion_results (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  criterion_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('Passed','Failed','Pending manual','Not verified')),
  evidence text NOT NULL,
  scenario_ids jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (org_id,run_id,criterion_id),
  FOREIGN KEY (org_id,run_id) REFERENCES agent_runs(org_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS engineering_release_verifications (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  specification_id uuid NOT NULL,
  specification_revision integer NOT NULL CHECK (specification_revision > 0),
  status text NOT NULL CHECK (status IN ('Passed','Failed')),
  environment text NOT NULL,
  evidence text NOT NULL,
  verified_by text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,problem_id)
    REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,specification_id)
    REFERENCES engineering_ticket_specifications(org_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS engineering_prompts_problem_idx
  ON implementation_prompts(org_id,problem_id,revision DESC);
CREATE INDEX IF NOT EXISTS engineering_approvals_idx
  ON approval_requests(org_id,action_type,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_problem_idx
  ON agent_runs(org_id,problem_id,queued_at DESC);
CREATE INDEX IF NOT EXISTS engineering_release_verifications_problem_idx
  ON engineering_release_verifications(org_id,problem_id,verified_at DESC);
