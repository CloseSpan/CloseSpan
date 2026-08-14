-- Migration 042 used PostgreSQL's untruncated source identifier, but PostgreSQL
-- stores automatically generated identifiers at a maximum of 63 bytes. Remove
-- the actual legacy constraint so the partial active-attempt index can govern
-- retries while completed attempts remain available for audit.
ALTER TABLE pdd_prompt_verifications
  DROP CONSTRAINT IF EXISTS pdd_prompt_verifications_org_id_prompt_revision_id_story_ha_key;

