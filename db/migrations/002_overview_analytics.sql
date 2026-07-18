CREATE TABLE IF NOT EXISTS accounts (
  id text NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  arr integer NOT NULL CHECK (arr >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,id)
);

CREATE TABLE IF NOT EXISTS problem_account_impacts (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  account_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,problem_id,account_id),
  FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,account_id) REFERENCES accounts(org_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS problem_period_metrics (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  current_signals integer NOT NULL CHECK (current_signals >= 0),
  previous_signals integer NOT NULL CHECK (previous_signals >= 0),
  period_days integer NOT NULL DEFAULT 7 CHECK (period_days > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,problem_id),
  FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS problem_confidence_evidence (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  evidence_id text NOT NULL,
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  PRIMARY KEY (org_id,problem_id,evidence_id),
  FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS weekly_signal_metrics (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source text NOT NULL,
  week_index integer NOT NULL CHECK (week_index BETWEEN 1 AND 8),
  signal_count integer NOT NULL CHECK (signal_count >= 0),
  PRIMARY KEY (org_id,source,week_index)
);

CREATE TABLE IF NOT EXISTS theme_period_metrics (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  theme text NOT NULL,
  current_signals integer NOT NULL CHECK (current_signals >= 0),
  previous_signals integer NOT NULL CHECK (previous_signals >= 0),
  rank integer NOT NULL CHECK (rank > 0),
  PRIMARY KEY (org_id,theme)
);

CREATE TABLE IF NOT EXISTS resolution_samples (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  comparison_period text NOT NULL CHECK (comparison_period IN ('current','previous')),
  duration_days numeric(6,2) NOT NULL CHECK (duration_days >= 0)
);

CREATE INDEX IF NOT EXISTS account_impacts_problem_idx ON problem_account_impacts(org_id,problem_id);
CREATE INDEX IF NOT EXISTS weekly_signals_org_week_idx ON weekly_signal_metrics(org_id,week_index);
