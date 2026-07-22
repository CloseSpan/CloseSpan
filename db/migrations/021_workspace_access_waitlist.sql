CREATE TABLE IF NOT EXISTS workspace_access_waitlist (
  email text PRIMARY KEY,
  display_name text,
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending','Approved','Declined')),
  login_attempt_count integer NOT NULL DEFAULT 1
    CHECK (login_attempt_count > 0),
  first_attempted_at timestamptz NOT NULL DEFAULT now(),
  last_attempted_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(email) BETWEEN 3 AND 320),
  CHECK (email = lower(btrim(email))),
  CHECK (position('@' in email) > 1),
  CHECK (
    display_name IS NULL
    OR char_length(btrim(display_name)) BETWEEN 1 AND 160
  )
);

CREATE INDEX IF NOT EXISTS workspace_access_waitlist_last_attempt_idx
  ON workspace_access_waitlist(last_attempted_at DESC);
