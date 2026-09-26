-- Confidence remains adjustable; preserve existing workspace selections.
ALTER TABLE workspace_settings
  ALTER COLUMN prompt_draft_min_evidence SET DEFAULT 1,
  ALTER COLUMN prompt_draft_min_confidence SET DEFAULT 0.65;

UPDATE workspace_settings
SET prompt_draft_min_evidence=1, updated_at=now()
WHERE prompt_draft_min_evidence <> 1;

ALTER TABLE workspace_settings
  DROP CONSTRAINT IF EXISTS workspace_settings_prompt_draft_min_evidence_check;

ALTER TABLE workspace_settings
  ADD CONSTRAINT workspace_settings_prompt_draft_min_evidence_check
    CHECK (prompt_draft_min_evidence = 1);
