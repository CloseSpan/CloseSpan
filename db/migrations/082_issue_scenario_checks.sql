-- Dedicated durable reservations protect manual issue checks from paid retry duplication.
CREATE TABLE IF NOT EXISTS issue_scenario_checks (
  id uuid PRIMARY KEY,
  org_id text NOT NULL,
  problem_id text NOT NULL,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  prompt_id uuid NOT NULL,
  prompt_hash text NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  user_story text NOT NULL CHECK (length(user_story) BETWEEN 3 AND 2000),
  status text NOT NULL CHECK (status IN ('processing','completed','failed')),
  evaluation_id uuid,
  prompt_evaluation jsonb,
  reserved_budget_usd numeric NOT NULL CHECK (reserved_budget_usd > 0 AND reserved_budget_usd <= 5),
  cost_usd numeric CHECK (cost_usd >= 0 AND cost_usd <= reserved_budget_usd),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id,problem_id,idempotency_key),
  FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,prompt_id) REFERENCES implementation_prompts(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,evaluation_id) REFERENCES pdd_prompt_evaluations(org_id,id) ON DELETE SET NULL (evaluation_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS issue_scenario_check_one_active
  ON issue_scenario_checks(org_id,problem_id) WHERE status='processing';
CREATE INDEX IF NOT EXISTS issue_scenario_check_current_history
  ON issue_scenario_checks(org_id,problem_id,prompt_hash,created_at DESC);
CREATE INDEX IF NOT EXISTS issue_scenario_check_budget
  ON issue_scenario_checks(org_id,created_at);
