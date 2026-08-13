ALTER TABLE implementation_prompts
  DROP CONSTRAINT IF EXISTS implementation_prompts_org_id_content_hash_key;

ALTER TABLE implementation_prompts
  ADD CONSTRAINT implementation_prompts_org_problem_content_hash_key
  UNIQUE (org_id,problem_id,content_hash);
