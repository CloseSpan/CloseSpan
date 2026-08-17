CREATE TABLE IF NOT EXISTS slack_intake_candidates (
  id text NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id text NOT NULL,
  channel_id text NOT NULL,
  anchor_ts text NOT NULL,
  author_id text,
  state text NOT NULL DEFAULT 'Pending'
    CHECK (state IN ('Pending','Review','Confirmed','Ignored','Deleted')),
  classification text
    CHECK (classification IS NULL OR classification IN (
      'Bug','Feature request','Usability','Question','Incident','Noise'
    )),
  confidence real NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  decision_reason text NOT NULL DEFAULT '',
  summary_text text NOT NULL DEFAULT '',
  message_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb,
  quiet_until timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  confirmation_message_ts text,
  promoted_feedback_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, team_id, channel_id, anchor_ts),
  FOREIGN KEY (org_id, promoted_feedback_id)
    REFERENCES feedback_items(org_id, id)
    ON DELETE SET NULL (promoted_feedback_id)
);

CREATE INDEX IF NOT EXISTS slack_intake_candidates_maturity_idx
  ON slack_intake_candidates(org_id, state, quiet_until);

CREATE INDEX IF NOT EXISTS slack_intake_candidates_author_idx
  ON slack_intake_candidates(org_id, channel_id, author_id, last_message_at DESC);

COMMENT ON TABLE slack_intake_candidates IS
  'Slack conversations held behind a grace period and intent gate before promotion to customer feedback.';
