CREATE TABLE IF NOT EXISTS feature_requests (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'Backlog'
    CHECK (status IN ('Backlog','Planned','In progress','Shipped')),
  voting_open boolean NOT NULL DEFAULT true,
  moderation_status text NOT NULL DEFAULT 'Pending review'
    CHECK (moderation_status IN ('Pending review','Published','Rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(btrim(title)) BETWEEN 4 AND 120),
  CHECK (char_length(btrim(description)) BETWEEN 10 AND 2000)
);

CREATE TABLE IF NOT EXISTS feature_request_rate_limits (
  action text NOT NULL CHECK (action IN ('submit','vote')),
  actor_hash text NOT NULL CHECK (actor_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (action,actor_hash,window_start)
);

CREATE TABLE IF NOT EXISTS feature_request_votes (
  request_id uuid NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
  voter_hash text NOT NULL CHECK (voter_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id,voter_hash)
);

CREATE INDEX IF NOT EXISTS feature_requests_status_created_idx
  ON feature_requests(moderation_status,status,created_at DESC);
CREATE INDEX IF NOT EXISTS feature_request_votes_request_created_idx
  ON feature_request_votes(request_id,created_at DESC);
CREATE INDEX IF NOT EXISTS feature_request_rate_limits_updated_idx
  ON feature_request_rate_limits(updated_at);
