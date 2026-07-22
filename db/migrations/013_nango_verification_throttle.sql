-- Coordinate post-OAuth API confirmation across serverless instances so a
-- browser retry cannot fan out into repeated Nango connection-list requests.
ALTER TABLE integration_connection_attempts
  ADD COLUMN IF NOT EXISTS verification_lease_until timestamptz;

CREATE INDEX IF NOT EXISTS nango_attempts_verification_lease_idx
  ON integration_connection_attempts(verification_lease_until)
  WHERE state = 'Pending';
