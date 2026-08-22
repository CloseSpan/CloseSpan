CREATE TABLE IF NOT EXISTS discord_app_installations (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  guild_id text NOT NULL UNIQUE,
  guild_name text,
  bot_user_id text NOT NULL,
  encrypted_access_token text NOT NULL,
  token_iv text NOT NULL,
  token_auth_tag text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(scopes) = 'array'),
  intake_mode text NOT NULL DEFAULT 'commands'
    CHECK (intake_mode IN ('commands','channels')),
  monitored_channel_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(monitored_channel_ids) = 'array'),
  state text NOT NULL DEFAULT 'Connected'
    CHECK (state IN ('Connected','Disconnected','Needs reconnect')),
  installed_by text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discord_app_installations_guild_idx
  ON discord_app_installations(guild_id);

CREATE TABLE IF NOT EXISTS discord_intake_candidates (
  id text NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  message_id text NOT NULL,
  author_id text,
  author_name text,
  submitted_by_id text,
  content text NOT NULL,
  classification text NOT NULL
    CHECK (classification IN (
      'Bug','Feature request','Usability','Question','Incident','Noise'
    )),
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  decision_reason text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'Review'
    CHECK (state IN ('Review','Confirmed','Ignored')),
  promoted_feedback_id text,
  confirmation_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,id),
  UNIQUE (org_id,guild_id,channel_id,message_id),
  FOREIGN KEY (org_id,promoted_feedback_id)
    REFERENCES feedback_items(org_id,id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS discord_intake_candidates_state_idx
  ON discord_intake_candidates(org_id,state,created_at DESC);

CREATE TABLE IF NOT EXISTS discord_feedback_sources (
  org_id text NOT NULL,
  feedback_id text NOT NULL,
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  message_id text NOT NULL,
  author_id text,
  author_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,feedback_id),
  UNIQUE (org_id,guild_id,channel_id,message_id),
  FOREIGN KEY (org_id,feedback_id)
    REFERENCES feedback_items(org_id,id) ON DELETE CASCADE
);

COMMENT ON TABLE discord_app_installations IS
  'Workspace-scoped CloseSpan Discord installations and explicit channel-monitoring policy.';

COMMENT ON COLUMN discord_app_installations.intake_mode IS
  'commands accepts slash, mention, and message-context reports; channels additionally monitors explicitly selected channels.';

COMMENT ON TABLE discord_intake_candidates IS
  'Discord reports held for human confirmation before promotion to normalized customer feedback.';
