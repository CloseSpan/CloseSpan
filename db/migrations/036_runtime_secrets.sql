CREATE TABLE IF NOT EXISTS runtime_secrets (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_name text NOT NULL
    CHECK (environment_name ~ '^[A-Za-z_][A-Za-z0-9_]{0,127}$'),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  scope_type text NOT NULL CHECK (scope_type IN ('workspace','repository')),
  repository text NOT NULL DEFAULT '',
  workspace_root text NOT NULL DEFAULT '.',
  created_by text NOT NULL,
  create_idempotency_key text NOT NULL
    CHECK (create_idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope_type = 'workspace' AND repository = '' AND workspace_root = '.') OR
    (scope_type = 'repository'
      AND repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
      AND workspace_root <> ''
      AND workspace_root !~ '^/'
      AND workspace_root !~ '(^|/)\.\.(/|$)')
  ),
  UNIQUE (org_id,id),
  UNIQUE (org_id,scope_type,repository,workspace_root,environment_name),
  UNIQUE (org_id,create_idempotency_key)
);

CREATE OR REPLACE FUNCTION reject_runtime_secret_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR
     NEW.org_id IS DISTINCT FROM OLD.org_id OR
     NEW.environment_name IS DISTINCT FROM OLD.environment_name OR
     NEW.scope_type IS DISTINCT FROM OLD.scope_type OR
     NEW.repository IS DISTINCT FROM OLD.repository OR
     NEW.workspace_root IS DISTINCT FROM OLD.workspace_root OR
     NEW.created_by IS DISTINCT FROM OLD.created_by OR
     NEW.create_idempotency_key IS DISTINCT FROM OLD.create_idempotency_key OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'runtime secret identity and scope are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS runtime_secrets_identity_immutable
  ON runtime_secrets;
CREATE TRIGGER runtime_secrets_identity_immutable
  BEFORE UPDATE ON runtime_secrets
  FOR EACH ROW EXECUTE FUNCTION reject_runtime_secret_identity_change();

CREATE TABLE IF NOT EXISTS runtime_secret_versions (
  org_id text NOT NULL,
  secret_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  encrypted_value text NOT NULL CHECK (encrypted_value <> ''),
  value_iv text NOT NULL CHECK (value_iv <> ''),
  value_auth_tag text NOT NULL CHECK (value_auth_tag <> ''),
  key_id text NOT NULL CHECK (key_id = 'v1'),
  created_by text NOT NULL,
  idempotency_key text NOT NULL
    CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,secret_id,version),
  UNIQUE (org_id,secret_id,idempotency_key),
  FOREIGN KEY (org_id,secret_id)
    REFERENCES runtime_secrets(org_id,id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS runtime_secret_versions_latest_idx
  ON runtime_secret_versions(org_id,secret_id,version DESC);

CREATE TABLE IF NOT EXISTS runtime_secret_revocations (
  org_id text NOT NULL,
  secret_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  reason text NOT NULL DEFAULT 'Revoked by a workspace administrator'
    CHECK (length(reason) BETWEEN 1 AND 500),
  revoked_by text NOT NULL,
  idempotency_key text NOT NULL
    CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  revoked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,secret_id,version),
  UNIQUE (org_id,secret_id,idempotency_key),
  FOREIGN KEY (org_id,secret_id,version)
    REFERENCES runtime_secret_versions(org_id,secret_id,version)
    ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION reject_runtime_secret_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Tenant deletion remains possible through the organizations cascade.
    IF EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
      RAISE EXCEPTION 'runtime secret versions and revocations are immutable';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'runtime secret versions and revocations are immutable';
END;
$$;

DROP TRIGGER IF EXISTS runtime_secret_versions_immutable
  ON runtime_secret_versions;
CREATE TRIGGER runtime_secret_versions_immutable
  BEFORE UPDATE OR DELETE ON runtime_secret_versions
  FOR EACH ROW EXECUTE FUNCTION reject_runtime_secret_immutable_mutation();

DROP TRIGGER IF EXISTS runtime_secret_revocations_immutable
  ON runtime_secret_revocations;
CREATE TRIGGER runtime_secret_revocations_immutable
  BEFORE UPDATE OR DELETE ON runtime_secret_revocations
  FOR EACH ROW EXECUTE FUNCTION reject_runtime_secret_immutable_mutation();
