CREATE TABLE IF NOT EXISTS ai_provider_configs (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('xai','openai','anthropic','openrouter')),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 160),
  encrypted_api_key text,
  key_iv text,
  key_auth_tag text,
  key_hint text,
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  connection_status text NOT NULL DEFAULT 'Not configured'
    CHECK (connection_status IN ('Not configured','Stored','Verified','Failed')),
  last_verified_at timestamptz,
  last_error_code text,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (encrypted_api_key IS NULL AND key_iv IS NULL AND key_auth_tag IS NULL AND key_hint IS NULL)
    OR
    (encrypted_api_key IS NOT NULL AND key_iv IS NOT NULL AND key_auth_tag IS NOT NULL AND key_hint IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ai_provider_configs_provider_idx
  ON ai_provider_configs(provider,updated_at DESC);

UPDATE prompt_versions SET provider='multi-provider'
WHERE name='feedback-intelligence' AND provider='xai';
