ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'Growth';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS customer_since integer NOT NULL DEFAULT 2024;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS churn_risk text NOT NULL DEFAULT 'Low';

CREATE TABLE IF NOT EXISTS investigations (
  id text NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  hypothesis text NOT NULL,
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  assumptions jsonb NOT NULL DEFAULT '[]',
  missing_information jsonb NOT NULL DEFAULT '[]',
  proposed_action text NOT NULL,
  recommended_tests jsonb NOT NULL DEFAULT '[]',
  suspected_files jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,id),
  FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS integrations (
  id text NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  category text NOT NULL,
  connection_state text NOT NULL,
  last_sync_at timestamptz,
  data_scope text NOT NULL DEFAULT 'None',
  permissions jsonb NOT NULL DEFAULT '[]',
  error_message text,
  display_order integer NOT NULL,
  PRIMARY KEY (org_id,id),
  UNIQUE (org_id,provider)
);

CREATE TABLE IF NOT EXISTS workspace_settings (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  autonomy_level text NOT NULL,
  pii_redaction boolean NOT NULL,
  retention_days integer NOT NULL CHECK (retention_days > 0),
  priority_weights jsonb NOT NULL,
  monthly_model_budget integer NOT NULL CHECK (monthly_model_budget >= 0),
  used_model_cost integer NOT NULL CHECK (used_model_cost >= 0),
  hard_stop boolean NOT NULL,
  plan_name text NOT NULL,
  plan_price text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id text NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  team text NOT NULL,
  PRIMARY KEY (org_id,id),
  UNIQUE (org_id,email)
);

CREATE INDEX IF NOT EXISTS investigations_problem_idx ON investigations(org_id,problem_id);
CREATE INDEX IF NOT EXISTS integrations_order_idx ON integrations(org_id,display_order);
