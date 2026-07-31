ALTER TABLE feature_request_votes
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'up';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'feature_request_votes_direction_check'
  ) THEN
    ALTER TABLE feature_request_votes
      ADD CONSTRAINT feature_request_votes_direction_check
      CHECK (direction IN ('up','down'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS feature_request_votes_request_direction_idx
  ON feature_request_votes(request_id,direction);
