CREATE TABLE IF NOT EXISTS tenki_runner_sizing_probes (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repository text NOT NULL,
  workspace_root text NOT NULL DEFAULT '.',
  profile_id uuid NOT NULL,
  profile_hash text NOT NULL CHECK (profile_hash ~ '^[a-f0-9]{64}$'),
  source_sha text NOT NULL CHECK (source_sha ~ '^[a-f0-9]{40,64}$'),
  workflow_path text NOT NULL DEFAULT '.github/workflows/closespan-runner-sizing.yml',
  workflow_sha256 text NOT NULL CHECK (workflow_sha256 ~ '^[a-f0-9]{64}$'),
  runner_label text NOT NULL,
  workload_class text NOT NULL CHECK (
    workload_class IN ('lightweight','application','build_heavy','android_emulator','ios_simulator')
  ),
  workload_reasons jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(workload_reasons) = 'array'),
  probe_commands jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(probe_commands) = 'array'),
  working_directory text NOT NULL DEFAULT '.',
  status text NOT NULL CHECK (status IN ('Queued','Dispatched','Running','Completed','Failed')),
  telemetry jsonb CHECK (telemetry IS NULL OR jsonb_typeof(telemetry) = 'object'),
  recommended_runner_label text,
  recommendation_reasons jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(recommendation_reasons) = 'array'),
  github_workflow_run_id bigint,
  failure_code text,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id,profile_id),
  FOREIGN KEY (org_id,repository,workspace_root,profile_id,profile_hash)
    REFERENCES execution_profile_versions(
      org_id,repository,workspace_root,id,content_hash
    ) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
    AND workspace_root <> ''
    AND workspace_root !~ '^/'
    AND workspace_root !~ '(^|/)\.\.(/|$)'
  )
);

CREATE INDEX IF NOT EXISTS tenki_runner_sizing_probes_scope_idx
  ON tenki_runner_sizing_probes(org_id,repository,status,updated_at DESC);

CREATE INDEX IF NOT EXISTS tenki_runner_sizing_probes_profile_idx
  ON tenki_runner_sizing_probes(org_id,profile_id,status);
