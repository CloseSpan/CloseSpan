CREATE TABLE IF NOT EXISTS platform_user_activity (
  email text PRIMARY KEY,
  display_name text,
  sign_in_count integer NOT NULL DEFAULT 1 CHECK (sign_in_count > 0),
  first_signed_in_at timestamptz NOT NULL DEFAULT now(),
  last_signed_in_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(email) BETWEEN 3 AND 320),
  CHECK (email = lower(btrim(email))),
  CHECK (position('@' in email) > 1),
  CHECK (
    display_name IS NULL
    OR char_length(btrim(display_name)) BETWEEN 1 AND 160
  )
);

CREATE INDEX IF NOT EXISTS platform_user_activity_last_sign_in_idx
  ON platform_user_activity(last_signed_in_at DESC);
