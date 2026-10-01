-- Account access controls are platform-wide, independent of tenant deletion.
-- Deleted-account tombstones prevent automatic recreation on the next login.
CREATE TABLE IF NOT EXISTS platform_user_access (
  email text PRIMARY KEY CHECK (email = lower(btrim(email))),
  status text NOT NULL CHECK (status IN ('Active','Blocked','Deleted')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_user_admin_events (
  id uuid PRIMARY KEY,
  actor_email text NOT NULL,
  target_email text NOT NULL,
  action text NOT NULL CHECK (action IN ('block','unblock','delete')),
  previous_status text NOT NULL,
  organization_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_email,request_id)
);
