ALTER TABLE github_repository_allowlists
  ADD COLUMN IF NOT EXISTS execution_branch text;

UPDATE github_repository_allowlists
   SET execution_branch=default_branch
 WHERE execution_branch IS NULL OR btrim(execution_branch)='';

ALTER TABLE github_repository_allowlists
  ALTER COLUMN execution_branch SET NOT NULL;
