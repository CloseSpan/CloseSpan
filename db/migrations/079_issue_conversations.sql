-- A durable request is reserved before inference; retries never reclaim paid work.
CREATE TABLE IF NOT EXISTS issue_conversation_requests (
  id uuid PRIMARY KEY,
  org_id text NOT NULL,
  problem_id text NOT NULL,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('processing','completed','failed')),
  provider text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id,problem_id,idempotency_key),
  UNIQUE (org_id,problem_id,id),
  FOREIGN KEY (org_id,problem_id) REFERENCES product_problems(org_id,id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS issue_conversation_one_active_request
  ON issue_conversation_requests(org_id,problem_id) WHERE status='processing';

CREATE TABLE IF NOT EXISTS issue_conversation_messages (
  id uuid PRIMARY KEY,
  org_id text NOT NULL,
  problem_id text NOT NULL,
  request_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  proposal jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id,role),
  FOREIGN KEY (org_id,problem_id,request_id)
    REFERENCES issue_conversation_requests(org_id,problem_id,id) ON DELETE CASCADE,
  CHECK (proposal IS NULL OR role='assistant')
);

CREATE INDEX IF NOT EXISTS issue_conversation_history
  ON issue_conversation_messages(org_id,problem_id,created_at,id);
