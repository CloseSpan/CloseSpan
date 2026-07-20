-- Production workspaces can exist before the first problem or approval is created.
ALTER TABLE workspaces
  ALTER COLUMN primary_problem_id DROP NOT NULL;

ALTER TABLE workspaces
  ALTER COLUMN primary_approval_id DROP NOT NULL;
