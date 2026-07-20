-- Supports the shared one-minute paid-provider claim window without scanning
-- unrelated idempotency records in a busy workspace.
CREATE INDEX IF NOT EXISTS idempotency_keys_action_created_idx
  ON idempotency_keys(org_id, action, created_at DESC);
