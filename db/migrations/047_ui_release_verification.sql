ALTER TABLE post_release_verification_jobs
  ADD COLUMN IF NOT EXISTS target_url text,
  ADD COLUMN IF NOT EXISTS verification_plan jsonb,
  ADD COLUMN IF NOT EXISTS ui_baseline jsonb,
  ADD COLUMN IF NOT EXISTS verification_result jsonb,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes');

ALTER TABLE post_release_verification_jobs
  ADD CONSTRAINT post_release_verification_jobs_attempt_count_check
  CHECK (attempt_count >= 0 AND attempt_count <= 20);

CREATE INDEX IF NOT EXISTS post_release_verification_jobs_expiry_idx
  ON post_release_verification_jobs(status,expires_at)
  WHERE status IN ('Queued','Running');
