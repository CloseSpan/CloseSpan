ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS prompt_draft_notify_in_app boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS prompt_draft_notify_email boolean NOT NULL DEFAULT false;

UPDATE workspace_settings
   SET prompt_draft_notify_in_app=prompt_draft_notify_reviewer
 WHERE prompt_draft_notify_in_app IS DISTINCT FROM prompt_draft_notify_reviewer;

ALTER TABLE implementation_prompts
  ADD COLUMN IF NOT EXISTS reviewer_email_notification_requested boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS prompt_review_email_outbox (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prompt_id uuid NOT NULL,
  problem_id text NOT NULL,
  reviewer_id text NOT NULL,
  to_email text NOT NULL,
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending','Sending','Sent','Failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,prompt_id)
    REFERENCES implementation_prompts(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,problem_id)
    REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,reviewer_id)
    REFERENCES workspace_members(org_id,id) ON DELETE CASCADE,
  UNIQUE (org_id,prompt_id,reviewer_id)
);

CREATE INDEX IF NOT EXISTS prompt_review_email_outbox_delivery_idx
  ON prompt_review_email_outbox(status,next_attempt_at,created_at)
  WHERE status IN ('Pending','Sending');
