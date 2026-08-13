ALTER TABLE investigations
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'Unverified',
  ADD COLUMN IF NOT EXISTS verification_method text,
  ADD COLUMN IF NOT EXISTS verification_summary text,
  ADD COLUMN IF NOT EXISTS verification_actor_id text,
  ADD COLUMN IF NOT EXISTS verification_actor_name text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE investigations
  DROP CONSTRAINT IF EXISTS investigations_verification_status_check;

ALTER TABLE investigations
  ADD CONSTRAINT investigations_verification_status_check
  CHECK (verification_status IN (
    'Unverified','Confirmed current','Not reproduced','Already resolved','Verification blocked'
  ));

CREATE INDEX IF NOT EXISTS investigations_org_verification_idx
  ON investigations(org_id,verification_status,updated_at DESC);
