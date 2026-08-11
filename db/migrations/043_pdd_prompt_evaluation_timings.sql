CREATE TABLE IF NOT EXISTS pdd_prompt_evaluation_timings (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('Succeeded','Failed')),
  duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 1 AND 300000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,problem_id)
    REFERENCES product_problems(org_id,id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pdd_prompt_evaluation_timings_recent_idx
  ON pdd_prompt_evaluation_timings(org_id,created_at DESC)
  WHERE status='Succeeded';
