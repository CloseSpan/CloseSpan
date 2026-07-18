CREATE TABLE IF NOT EXISTS prompt_versions (
  id text NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  provider text NOT NULL,
  purpose text NOT NULL,
  system_prompt text NOT NULL,
  output_schema jsonb NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,id),
  UNIQUE (org_id,name,version)
);

CREATE UNIQUE INDEX IF NOT EXISTS prompt_versions_one_active_idx
  ON prompt_versions(org_id,name) WHERE active;

CREATE TABLE IF NOT EXISTS model_runs (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prompt_version_id text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('Running','Succeeded','Failed')),
  idempotency_key text NOT NULL,
  input_record_ids jsonb NOT NULL,
  output jsonb,
  external_response_id text,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (org_id,prompt_version_id) REFERENCES prompt_versions(org_id,id),
  UNIQUE (org_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS ai_feedback_analyses (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  model_run_id uuid NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  feedback_id text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('Bug','Feature request','Usability','Question','Incident','Noise')),
  severity text NOT NULL CHECK (severity IN ('Critical','High','Medium','Low')),
  redacted_summary text NOT NULL,
  proposed_problem_id text,
  classification_confidence real NOT NULL CHECK (classification_confidence BETWEEN 0 AND 1),
  cluster_confidence real NOT NULL CHECK (cluster_confidence BETWEEN 0 AND 1),
  confidence_factors jsonb NOT NULL,
  rationale text NOT NULL,
  evidence jsonb NOT NULL,
  review_status text NOT NULL DEFAULT 'Proposed' CHECK (review_status IN ('Proposed','Approved','Rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,feedback_id) REFERENCES feedback_items(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,proposed_problem_id) REFERENCES product_problems(org_id,id),
  UNIQUE (org_id,model_run_id,feedback_id)
);

CREATE INDEX IF NOT EXISTS model_runs_org_started_idx ON model_runs(org_id,started_at DESC);
CREATE INDEX IF NOT EXISTS ai_feedback_analyses_review_idx ON ai_feedback_analyses(org_id,review_status,created_at DESC);
