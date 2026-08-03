CREATE TABLE IF NOT EXISTS slack_intake_connections (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  team_id text NOT NULL,
  team_name text,
  channel_id text NOT NULL,
  channel_name text NOT NULL DEFAULT 'closespan-feedback',
  state text NOT NULL DEFAULT 'Connected'
    CHECK (state IN ('Connected','Needs reconnect','Disconnected','Error')),
  cursor_ts text NOT NULL,
  welcome_message_ts text,
  connected_by text NOT NULL,
  last_polled_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, channel_id)
);

CREATE TABLE IF NOT EXISTS slack_feedback_sources (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feedback_id text NOT NULL,
  team_id text NOT NULL,
  channel_id text NOT NULL,
  message_ts text NOT NULL,
  thread_ts text NOT NULL,
  author_id text,
  reaction_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  file_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, feedback_id),
  FOREIGN KEY (org_id, feedback_id)
    REFERENCES feedback_items(org_id, id) ON DELETE CASCADE,
  UNIQUE (team_id, channel_id, message_ts)
);

CREATE TABLE IF NOT EXISTS slack_problem_threads (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  channel_id text NOT NULL,
  thread_ts text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, problem_id),
  FOREIGN KEY (org_id, problem_id)
    REFERENCES product_problems(org_id, id) ON DELETE CASCADE,
  UNIQUE (channel_id, thread_ts)
);

CREATE TABLE IF NOT EXISTS slack_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'problem_detected','approval_required','run_blocked','draft_pr_opened',
    'released','verification_required','verified'
  )),
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending','Sending','Sent','Failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  slack_message_ts text,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, idempotency_key),
  FOREIGN KEY (org_id, problem_id)
    REFERENCES product_problems(org_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS slack_outbox_delivery_idx
  ON slack_notification_outbox(status, available_at, created_at);

CREATE INDEX IF NOT EXISTS slack_feedback_message_idx
  ON slack_feedback_sources(org_id, channel_id, message_ts);
