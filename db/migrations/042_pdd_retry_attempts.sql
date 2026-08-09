-- Keep every completed PDD attempt for auditability while allowing a product
-- manager to retry the same immutable prompt and story after a failed runner
-- attempt. Only one live or reviewable attempt may exist at a time.
ALTER TABLE pdd_prompt_verifications
  DROP CONSTRAINT IF EXISTS pdd_prompt_verifications_org_id_prompt_revision_id_story_hash_key;

CREATE UNIQUE INDEX IF NOT EXISTS pdd_prompt_verifications_story_active_idx
  ON pdd_prompt_verifications(org_id,prompt_revision_id,story_hash)
  WHERE status IN ('Queued','Generating tests','Ready for approval');
