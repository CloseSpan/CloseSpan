CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  primary_problem_id text NOT NULL,
  primary_approval_id text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id), UNIQUE (org_id)
);

CREATE TABLE IF NOT EXISTS feedback_items (
  id text NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source text NOT NULL, customer_name text NOT NULL, account_tier text NOT NULL,
  arr integer NOT NULL CHECK (arr >= 0), type text NOT NULL, severity text NOT NULL,
  redacted boolean NOT NULL DEFAULT false, environment text NOT NULL,
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  observed_at text NOT NULL, quote text NOT NULL, raw_content_encrypted bytea,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);

CREATE TABLE IF NOT EXISTS product_problems (
  id text NOT NULL, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL, statement text NOT NULL, summary text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('Detected','Needs review','Approved','Planned','In progress','Released','Verified','Closed')),
  severity text NOT NULL CHECK (severity IN ('Critical','High','Medium','Low')),
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  product_area text NOT NULL, team text NOT NULL, churn_risk integer NOT NULL CHECK (churn_risk BETWEEN 0 AND 100),
  suspected_repository text NOT NULL, suspected_files jsonb NOT NULL DEFAULT '[]', impact_factors jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);

CREATE TABLE IF NOT EXISTS feedback_cluster_memberships (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL, feedback_id text NOT NULL,
  similarity real NOT NULL CHECK (similarity BETWEEN 0 AND 1), explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, problem_id, feedback_id),
  FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,feedback_id) REFERENCES feedback_items(org_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id text NOT NULL, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL, recommendation_id text NOT NULL, action text NOT NULL, reason text NOT NULL,
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1), systems jsonb NOT NULL, data_shared jsonb NOT NULL,
  reversible boolean NOT NULL, risk text NOT NULL CHECK (risk IN ('Low','Medium','High')),
  status text NOT NULL CHECK (status IN ('Pending','Approved','Rejected')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,id), FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_work_items (
  id uuid PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL, provider text NOT NULL, external_key text NOT NULL, url text NOT NULL, simulated boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  UNIQUE (org_id,provider,external_key)
);

CREATE TABLE IF NOT EXISTS customer_notifications (
  id uuid PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL, customer_name text NOT NULL, status text NOT NULL CHECK (status IN ('Drafted','Approved','Sent')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  UNIQUE (org_id,problem_id,customer_name)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(), actor_id text NOT NULL, actor_name text NOT NULL,
  action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, trace_id text NOT NULL,
  UNIQUE (org_id,trace_id,action)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,key)
);

CREATE INDEX IF NOT EXISTS feedback_items_org_created_idx ON feedback_items(org_id,created_at DESC);
CREATE INDEX IF NOT EXISTS problems_org_stage_idx ON product_problems(org_id,stage);
CREATE INDEX IF NOT EXISTS audit_org_time_idx ON audit_events(org_id,occurred_at DESC);
