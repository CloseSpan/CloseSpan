ALTER TABLE slack_intake_connections
  ADD COLUMN IF NOT EXISTS intake_mode text NOT NULL DEFAULT 'channel'
    CHECK (intake_mode IN ('channel','mentions'));

CREATE TABLE IF NOT EXISTS slack_app_installations (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  team_id text NOT NULL,
  team_name text,
  bot_user_id text NOT NULL,
  encrypted_access_token text NOT NULL,
  token_iv text NOT NULL,
  token_auth_tag text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(scopes) = 'array'),
  state text NOT NULL DEFAULT 'Connected'
    CHECK (state IN ('Connected','Disconnected','Needs reconnect')),
  installed_by text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS slack_app_installations_team_idx
  ON slack_app_installations(team_id);

COMMENT ON COLUMN slack_intake_connections.intake_mode IS
  'channel monitors the configured channel; mentions records only conversations that explicitly mention the CloseSpan bot.';

COMMENT ON TABLE slack_app_installations IS
  'Tenant-scoped CloseSpan Slack bot installations. Bot tokens are encrypted with authenticated organization binding.';
