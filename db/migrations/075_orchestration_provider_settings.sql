CREATE TABLE IF NOT EXISTS orchestration_provider_settings (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  active_provider text NOT NULL DEFAULT 'pipedream'
    CHECK (active_provider IN ('pipedream', 'n8n')),
  n8n_base_url text,
  n8n_trigger_url text,
  encrypted_n8n_api_key text,
  n8n_api_key_iv text,
  n8n_api_key_auth_tag text,
  n8n_api_key_hint text,
  encrypted_n8n_signing_secret text,
  n8n_signing_secret_iv text,
  n8n_signing_secret_auth_tag text,
  n8n_signing_secret_hint text,
  n8n_connection_status text NOT NULL DEFAULT 'Not configured'
    CHECK (n8n_connection_status IN ('Not configured', 'Verified', 'Failed')),
  n8n_last_verified_at timestamptz,
  n8n_last_error_code text,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (encrypted_n8n_api_key IS NULL AND n8n_api_key_iv IS NULL AND n8n_api_key_auth_tag IS NULL)
    OR
    (encrypted_n8n_api_key IS NOT NULL AND n8n_api_key_iv IS NOT NULL AND n8n_api_key_auth_tag IS NOT NULL)
  ),
  CHECK (
    (encrypted_n8n_signing_secret IS NULL AND n8n_signing_secret_iv IS NULL AND n8n_signing_secret_auth_tag IS NULL)
    OR
    (encrypted_n8n_signing_secret IS NOT NULL AND n8n_signing_secret_iv IS NOT NULL AND n8n_signing_secret_auth_tag IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS orchestration_provider_settings_active_idx
  ON orchestration_provider_settings(active_provider);
