ALTER TABLE slack_intake_connections
  ADD COLUMN IF NOT EXISTS bot_user_id text;

COMMENT ON COLUMN slack_intake_connections.bot_user_id IS
  'Slack app user ID returned by auth.test and used to recognize explicit @CloseSpan mentions.';
