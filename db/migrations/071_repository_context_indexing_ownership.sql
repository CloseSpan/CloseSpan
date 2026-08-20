ALTER TABLE repository_context_snapshots
  ADD COLUMN IF NOT EXISTS indexing_attempt_id uuid,
  ADD COLUMN IF NOT EXISTS indexing_lease_acquired_at timestamptz;

CREATE INDEX IF NOT EXISTS repository_context_snapshots_indexing_attempt_idx
  ON repository_context_snapshots(org_id,indexing_attempt_id)
  WHERE indexing_attempt_id IS NOT NULL;
