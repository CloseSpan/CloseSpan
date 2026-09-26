CREATE TABLE IF NOT EXISTS problem_prompt_reviews (
  org_id text NOT NULL REFERENCES organizations(id),
  problem_id text NOT NULL,
  status text NOT NULL DEFAULT 'Queued' CHECK (status IN (
    'Queued','Waiting for verification','Testing','Ready','Confirmed',
    'Preparing tests','Awaiting approval','Needs attention'
  )),
  version integer NOT NULL DEFAULT 1,
  prompt_hash text,
  user_story text NOT NULL DEFAULT '',
  feedback text NOT NULL DEFAULT '',
  evaluation jsonb,
  attempts integer NOT NULL DEFAULT 0,
  failure_message text,
  confirmed_by text,
  confirmed_at timestamptz,
  lease_id text,
  leased_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,problem_id),
  FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id)
);
CREATE INDEX IF NOT EXISTS problem_prompt_reviews_pending
  ON problem_prompt_reviews(org_id,updated_at)
  WHERE status IN ('Queued','Waiting for verification','Testing','Confirmed','Preparing tests');
