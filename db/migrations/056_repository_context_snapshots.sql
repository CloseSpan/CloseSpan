CREATE TABLE IF NOT EXISTS repository_context_snapshots (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  installation_id bigint NOT NULL,
  repository text NOT NULL,
  default_branch text NOT NULL,
  commit_sha text,
  provider text NOT NULL DEFAULT 'closespan',
  status text NOT NULL DEFAULT 'Queued'
    CHECK (status IN ('Queued','Discovering','Uploading','Indexing','Ready','Failed')),
  stage text NOT NULL DEFAULT 'Waiting to inspect repository',
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  total_files integer NOT NULL DEFAULT 0 CHECK (total_files >= 0),
  indexed_files integer NOT NULL DEFAULT 0 CHECK (indexed_files >= 0),
  skipped_files integer NOT NULL DEFAULT 0 CHECK (skipped_files >= 0),
  context_state jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id,repository)
);

CREATE INDEX IF NOT EXISTS repository_context_snapshots_org_status_idx
  ON repository_context_snapshots(org_id,status,updated_at DESC);

CREATE INDEX IF NOT EXISTS repository_context_snapshots_repository_commit_idx
  ON repository_context_snapshots(org_id,repository,commit_sha);
