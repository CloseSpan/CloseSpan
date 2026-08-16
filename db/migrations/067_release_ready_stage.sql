ALTER TABLE product_problems
  DROP CONSTRAINT IF EXISTS product_problems_stage_check;

ALTER TABLE product_problems
  ADD CONSTRAINT product_problems_stage_check
  CHECK (stage IN (
    'Detected',
    'Needs review',
    'Approved',
    'Planned',
    'In progress',
    'Release Ready',
    'Released',
    'Verified',
    'Closed'
  ));

ALTER TABLE engineering_ticket_specifications
  DROP CONSTRAINT IF EXISTS engineering_ticket_specifications_implementation_state_check;

ALTER TABLE engineering_ticket_specifications
  ADD CONSTRAINT engineering_ticket_specifications_implementation_state_check
  CHECK (implementation_state IN (
    'Draft specification',
    'Prompt ready',
    'Awaiting approval',
    'Running',
    'Tests passed',
    'Draft PR opened',
    'Release Ready',
    'Released',
    'Verified'
  ));

UPDATE product_problems AS problem
SET stage='Release Ready',updated_at=now()
WHERE problem.stage='In progress'
  AND EXISTS (
    SELECT 1
    FROM agent_runs AS run
    JOIN final_execution_attempts AS attempt
      ON attempt.org_id=run.org_id
     AND attempt.agent_run_id=run.id
    WHERE run.org_id=problem.org_id
      AND run.problem_id=problem.id
      AND run.pull_request_number IS NOT NULL
      AND attempt.status='Succeeded'
  );

UPDATE engineering_ticket_specifications AS specification
SET implementation_state='Release Ready',updated_at=now()
WHERE specification.implementation_state='Draft PR opened'
  AND EXISTS (
    SELECT 1
    FROM product_problems AS problem
    WHERE problem.org_id=specification.org_id
      AND problem.id=specification.problem_id
      AND problem.stage='Release Ready'
  );
