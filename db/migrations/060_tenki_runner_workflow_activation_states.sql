ALTER TABLE tenki_runner_workflow_setups
  ADD COLUMN IF NOT EXISTS failure_message text;

ALTER TABLE tenki_runner_workflow_setups
  DROP CONSTRAINT IF EXISTS tenki_runner_workflow_setups_status_check;

ALTER TABLE tenki_runner_workflow_setups
  DROP CONSTRAINT IF EXISTS tenki_runner_workflow_setups_check;

ALTER TABLE tenki_runner_workflow_setups
  ADD CONSTRAINT tenki_runner_workflow_setups_status_check
  CHECK (status IN ('Preparing','Pending','Installed','Failed'));

ALTER TABLE tenki_runner_workflow_setups
  ADD CONSTRAINT tenki_runner_workflow_setups_pending_pull_request_check
  CHECK (
    status <> 'Pending'
    OR (
      pull_request_number IS NOT NULL
      AND pull_request_number > 0
      AND pull_request_url IS NOT NULL
    )
  );
