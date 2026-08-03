ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS prompt_draft_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS prompt_draft_bug_reports boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS prompt_draft_feature_requests boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS prompt_draft_min_evidence integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS prompt_draft_min_confidence real NOT NULL DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS prompt_draft_notify_reviewer boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS prompt_draft_reviewer_id text;

ALTER TABLE workspace_settings
  DROP CONSTRAINT IF EXISTS workspace_settings_prompt_draft_mode_check,
  DROP CONSTRAINT IF EXISTS workspace_settings_prompt_draft_min_evidence_check,
  DROP CONSTRAINT IF EXISTS workspace_settings_prompt_draft_min_confidence_check,
  DROP CONSTRAINT IF EXISTS workspace_settings_prompt_draft_reviewer_fk;

ALTER TABLE workspace_settings
  ADD CONSTRAINT workspace_settings_prompt_draft_mode_check
    CHECK (prompt_draft_mode IN ('manual','automatic')),
  ADD CONSTRAINT workspace_settings_prompt_draft_min_evidence_check
    CHECK (prompt_draft_min_evidence BETWEEN 1 AND 100),
  ADD CONSTRAINT workspace_settings_prompt_draft_min_confidence_check
    CHECK (prompt_draft_min_confidence BETWEEN 0.5 AND 1),
  ADD CONSTRAINT workspace_settings_prompt_draft_reviewer_fk
    FOREIGN KEY (org_id,prompt_draft_reviewer_id)
    REFERENCES workspace_members(org_id,id)
    ON DELETE SET NULL (prompt_draft_reviewer_id);

ALTER TABLE implementation_prompts
  DROP CONSTRAINT IF EXISTS implementation_prompts_status_check;

ALTER TABLE implementation_prompts
  ADD CONSTRAINT implementation_prompts_status_check
    CHECK (status IN ('Draft','Ready','Awaiting approval','Approved','Superseded')),
  ADD COLUMN IF NOT EXISTS draft_reason text,
  ADD COLUMN IF NOT EXISTS reviewer_id text,
  ADD COLUMN IF NOT EXISTS reviewer_notification_requested boolean NOT NULL DEFAULT false;

ALTER TABLE implementation_prompts
  DROP CONSTRAINT IF EXISTS implementation_prompts_reviewer_fk;

ALTER TABLE implementation_prompts
  ADD CONSTRAINT implementation_prompts_reviewer_fk
    FOREIGN KEY (org_id,reviewer_id)
    REFERENCES workspace_members(org_id,id)
    ON DELETE SET NULL (reviewer_id);

CREATE INDEX IF NOT EXISTS implementation_prompts_reviewer_idx
  ON implementation_prompts(org_id,reviewer_id,status,created_at DESC)
  WHERE reviewer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS prompt_review_notifications (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prompt_id uuid NOT NULL,
  problem_id text NOT NULL,
  reviewer_id text NOT NULL,
  status text NOT NULL DEFAULT 'Unread' CHECK (status IN ('Unread','Read')),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  FOREIGN KEY (org_id,prompt_id)
    REFERENCES implementation_prompts(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,problem_id)
    REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,reviewer_id)
    REFERENCES workspace_members(org_id,id) ON DELETE CASCADE,
  UNIQUE (org_id,prompt_id,reviewer_id)
);

CREATE INDEX IF NOT EXISTS prompt_review_notifications_inbox_idx
  ON prompt_review_notifications(org_id,reviewer_id,status,created_at DESC);
