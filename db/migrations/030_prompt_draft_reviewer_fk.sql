ALTER TABLE workspace_settings
  DROP CONSTRAINT IF EXISTS workspace_settings_prompt_draft_reviewer_fk;

ALTER TABLE workspace_settings
  ADD CONSTRAINT workspace_settings_prompt_draft_reviewer_fk
    FOREIGN KEY (org_id,prompt_draft_reviewer_id)
    REFERENCES workspace_members(org_id,id)
    ON DELETE SET NULL (prompt_draft_reviewer_id);

ALTER TABLE implementation_prompts
  DROP CONSTRAINT IF EXISTS implementation_prompts_reviewer_fk;

ALTER TABLE implementation_prompts
  ADD CONSTRAINT implementation_prompts_reviewer_fk
    FOREIGN KEY (org_id,reviewer_id)
    REFERENCES workspace_members(org_id,id)
    ON DELETE SET NULL (reviewer_id);
