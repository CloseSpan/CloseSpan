INSERT INTO approval_requests(
  id,org_id,problem_id,recommendation_id,action,reason,confidence,systems,
  data_shared,reversible,risk,status,action_type,prompt_revision_id,
  repository,base_branch,base_sha,allowed_capabilities,expires_at,
  agent_run_id,pull_request_number,pull_request_url,head_sha,target_environment
)
SELECT
  'apr_final_' || md5(run.id::text),
  run.org_id,
  run.problem_id,
  run.id::text,
  'Merge pull request #' || run.pull_request_number || ' in ' || run.repository,
  'Independent verification passed. Human approval is required before the exact reviewed commit can be merged.',
  1,
  '["GitHub"]'::jsonb,
  '["Pull request metadata","Changed files","Test and acceptance evidence"]'::jsonb,
  false,
  'High',
  'Pending',
  'final_execution',
  run.prompt_revision_id,
  run.repository,
  run.base_branch,
  run.implementation_commit_sha,
  '["pull_requests:merge"]'::jsonb,
  now() + interval '24 hours',
  run.id,
  run.pull_request_number,
  run.pull_request_url,
  run.implementation_commit_sha,
  NULL
FROM agent_runs run
WHERE run.status='Draft PR opened'
  AND run.pull_request_number IS NOT NULL
  AND run.pull_request_url IS NOT NULL
  AND run.implementation_commit_sha ~ '^[a-f0-9]{40,64}$'
  AND run.implementation_report->'independentVerification'->>'status'='passed'
ON CONFLICT DO NOTHING;
