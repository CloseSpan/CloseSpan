-- One explicitly-created monitoring issue per workspace and deterministic finding.
CREATE TABLE IF NOT EXISTS agent_run_finding_issues (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  problem_id text NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, fingerprint),
  FOREIGN KEY (org_id, problem_id) REFERENCES product_problems(org_id, id) ON DELETE CASCADE
);
