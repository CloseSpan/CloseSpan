CREATE TABLE IF NOT EXISTS tenki_environment_artifacts (
  id uuid PRIMARY KEY,
  scope_type text NOT NULL
    CHECK (scope_type IN ('managed_toolchain','repository_private')),
  org_id text REFERENCES organizations(id) ON DELETE CASCADE,
  repository text NOT NULL DEFAULT '',
  workspace_root text NOT NULL DEFAULT '.',
  catalog_key text NOT NULL
    CHECK (catalog_key ~ '^[a-z0-9][a-z0-9._-]{1,119}$'),
  runtime_family text NOT NULL
    CHECK (runtime_family ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  runtime_version text,
  package_manager text,
  capabilities jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(capabilities) = 'array'),
  dependency_fingerprint text,
  source_sha text,
  version integer NOT NULL CHECK (version > 0),
  tenki_workspace_id text,
  template_id text,
  builder_session_id text,
  template_spec jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(template_spec) = 'object'),
  template_spec_hash text,
  build_id text,
  snapshot_id text,
  registry_image_id text,
  registry_digest_ref text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft','building','ready','active','failed','deprecated','deleting','deleted'
    )),
  approved boolean NOT NULL DEFAULT false,
  failure_reason text,
  supersedes_id uuid REFERENCES tenki_environment_artifacts(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  built_at timestamptz,
  activated_at timestamptz,
  deprecated_at timestamptz,
  expires_at timestamptz,
  validation_session_id text,
  validation_evidence jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(validation_evidence) = 'object'),
  last_verified_at timestamptz,
  last_used_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope_type = 'managed_toolchain'
      AND org_id IS NULL
      AND repository = ''
      AND workspace_root = '.')
    OR
    (scope_type = 'repository_private'
      AND org_id IS NOT NULL
      AND repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
      AND workspace_root <> ''
      AND workspace_root !~ '^/'
      AND workspace_root !~ '(^|/)\.\.(/|$)')
  ),
  CHECK (
    registry_digest_ref IS NULL
    OR (
      length(split_part(registry_digest_ref,'@',1)) BETWEEN 2 AND 400
      AND registry_digest_ref ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*@sha256:[a-f0-9]{64}$'
    )
    OR (
      scope_type='repository_private'
      AND snapshot_id IS NOT NULL
      AND length(split_part(registry_digest_ref,'@',1)) BETWEEN 2 AND 400
      AND registry_digest_ref ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND split_part(registry_digest_ref,'@',2)=snapshot_id::text
    )
  ),
  CHECK (
    status NOT IN ('ready','active','deprecated')
    OR (
      tenki_workspace_id IS NOT NULL
      AND (
        (scope_type='managed_toolchain' AND template_id IS NOT NULL AND build_id IS NOT NULL)
        OR
        (scope_type='repository_private' AND builder_session_id IS NOT NULL)
      )
      AND snapshot_id IS NOT NULL
      AND registry_image_id IS NOT NULL
      AND registry_digest_ref IS NOT NULL
      AND template_spec_hash ~ '^[a-f0-9]{64}$'
      AND built_at IS NOT NULL
      AND validation_session_id IS NOT NULL
      AND last_verified_at IS NOT NULL
    )
  ),
  CHECK (status <> 'active' OR approved),
  CHECK (NOT approved OR status IN ('ready','active','deprecated')),
  CHECK (supersedes_id IS NULL OR supersedes_id <> id),
  FOREIGN KEY (org_id,repository)
    REFERENCES github_repository_allowlists(org_id,repository)
    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX IF NOT EXISTS tenki_environment_artifacts_version_idx
  ON tenki_environment_artifacts(
    scope_type,
    COALESCE(org_id,''),
    repository,
    workspace_root,
    catalog_key,
    version
  );

CREATE UNIQUE INDEX IF NOT EXISTS tenki_environment_artifacts_active_idx
  ON tenki_environment_artifacts(
    scope_type,
    COALESCE(org_id,''),
    repository,
    workspace_root,
    catalog_key
  ) WHERE status='active';

CREATE UNIQUE INDEX IF NOT EXISTS tenki_environment_artifacts_digest_idx
  ON tenki_environment_artifacts(registry_digest_ref)
  WHERE registry_digest_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS tenki_environment_artifacts_selection_idx
  ON tenki_environment_artifacts(
    runtime_family,package_manager,status,approved,scope_type
  );

CREATE OR REPLACE FUNCTION guard_tenki_environment_artifact_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status='draft' AND NEW.status IN ('building','failed')) OR
    (OLD.status='building' AND NEW.status IN ('ready','failed')) OR
    (OLD.status='ready' AND NEW.status IN ('active','failed','deleting')) OR
    (OLD.status='active' AND NEW.status='deprecated') OR
    (OLD.status='deprecated' AND NEW.status='deleting') OR
    (OLD.status='failed' AND NEW.status='deleting') OR
    (OLD.status='deleting' AND NEW.status IN ('deleted','failed'))
  ) THEN
    RAISE EXCEPTION 'invalid Tenki environment artifact state transition: % -> %',
      OLD.status,NEW.status;
  END IF;
  IF OLD.built_at IS NOT NULL AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.scope_type IS DISTINCT FROM OLD.scope_type OR
    NEW.org_id IS DISTINCT FROM OLD.org_id OR
    NEW.repository IS DISTINCT FROM OLD.repository OR
    NEW.workspace_root IS DISTINCT FROM OLD.workspace_root OR
    NEW.catalog_key IS DISTINCT FROM OLD.catalog_key OR
    NEW.runtime_family IS DISTINCT FROM OLD.runtime_family OR
    NEW.runtime_version IS DISTINCT FROM OLD.runtime_version OR
    NEW.package_manager IS DISTINCT FROM OLD.package_manager OR
    NEW.capabilities IS DISTINCT FROM OLD.capabilities OR
    NEW.dependency_fingerprint IS DISTINCT FROM OLD.dependency_fingerprint OR
    NEW.source_sha IS DISTINCT FROM OLD.source_sha OR
    NEW.version IS DISTINCT FROM OLD.version OR
    NEW.tenki_workspace_id IS DISTINCT FROM OLD.tenki_workspace_id OR
    NEW.template_id IS DISTINCT FROM OLD.template_id OR
    NEW.builder_session_id IS DISTINCT FROM OLD.builder_session_id OR
    NEW.template_spec IS DISTINCT FROM OLD.template_spec OR
    NEW.template_spec_hash IS DISTINCT FROM OLD.template_spec_hash OR
    NEW.build_id IS DISTINCT FROM OLD.build_id OR
    NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id OR
    NEW.registry_image_id IS DISTINCT FROM OLD.registry_image_id OR
    NEW.registry_digest_ref IS DISTINCT FROM OLD.registry_digest_ref OR
    NEW.validation_session_id IS DISTINCT FROM OLD.validation_session_id OR
    NEW.validation_evidence IS DISTINCT FROM OLD.validation_evidence OR
    NEW.built_at IS DISTINCT FROM OLD.built_at OR
    (
      NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
      AND NOT (
        OLD.status='ready' AND NEW.status='active'
        AND OLD.supersedes_id IS NULL
      )
    ) OR
    NEW.created_by IS DISTINCT FROM OLD.created_by OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'a validated Tenki environment artifact is immutable';
  END IF;
  IF OLD.status = 'deleted' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'a deleted Tenki environment artifact cannot change';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenki_environment_artifacts_guard
  ON tenki_environment_artifacts;
CREATE TRIGGER tenki_environment_artifacts_guard
  BEFORE UPDATE ON tenki_environment_artifacts
  FOR EACH ROW EXECUTE FUNCTION guard_tenki_environment_artifact_update();

CREATE TABLE IF NOT EXISTS tenki_environment_artifact_events (
  id uuid PRIMARY KEY,
  artifact_id uuid NOT NULL REFERENCES tenki_environment_artifacts(id)
    ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type ~ '^[a-z][a-z0-9._-]{1,79}$'),
  detail jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(detail) = 'object'),
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenki_environment_artifact_events_lookup_idx
  ON tenki_environment_artifact_events(artifact_id,created_at DESC);

CREATE TABLE IF NOT EXISTS tenki_dependency_cache_volumes (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repository text NOT NULL,
  workspace_root text NOT NULL DEFAULT '.',
  cache_key text NOT NULL CHECK (cache_key ~ '^[a-f0-9]{64}$'),
  slot integer NOT NULL CHECK (slot BETWEEN 1 AND 8),
  tenki_workspace_id text NOT NULL,
  tenki_volume_id text,
  state text NOT NULL DEFAULT 'provisioning'
    CHECK (state IN ('provisioning','available','leased','failed','deleting','deleted')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1073741824 AND 107374182400),
  lease_run_id uuid,
  lease_expires_at timestamptz,
  owner_token uuid,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  CHECK (
    repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
    AND workspace_root <> ''
    AND workspace_root !~ '^/'
    AND workspace_root !~ '(^|/)\.\.(/|$)'
  ),
  CHECK (
    (state='leased' AND lease_run_id IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (state<>'leased' AND lease_run_id IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    (state IN ('provisioning','leased') AND owner_token IS NOT NULL)
    OR
    (state NOT IN ('provisioning','leased') AND owner_token IS NULL)
  ),
  UNIQUE (org_id,repository,workspace_root,cache_key,slot)
);

CREATE UNIQUE INDEX IF NOT EXISTS tenki_dependency_cache_volume_remote_idx
  ON tenki_dependency_cache_volumes(tenki_volume_id)
  WHERE tenki_volume_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tenki_dependency_cache_lease_idx
  ON tenki_dependency_cache_volumes(
    org_id,repository,workspace_root,cache_key,state,lease_expires_at
  );

CREATE OR REPLACE FUNCTION touch_tenki_dependency_cache_volume()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenki_dependency_cache_volumes_touch
  ON tenki_dependency_cache_volumes;
CREATE TRIGGER tenki_dependency_cache_volumes_touch
  BEFORE UPDATE ON tenki_dependency_cache_volumes
  FOR EACH ROW EXECUTE FUNCTION touch_tenki_dependency_cache_volume();

-- Provider resources outlive a customer row. Capture their exact immutable
-- IDs before a tenant/repository cascade so lifecycle cleanup remains durable
-- even after the tenant-scoped catalog rows have been erased.
CREATE TABLE IF NOT EXISTS tenki_external_cleanup_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL CHECK (source_kind IN ('artifact','cache')),
  source_id uuid NOT NULL,
  tenki_workspace_id text NOT NULL,
  ownership_token text NOT NULL,
  provider_refs jsonb NOT NULL CHECK (jsonb_typeof(provider_refs)='object'),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','processing','completed','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(source_kind,source_id)
);

CREATE INDEX IF NOT EXISTS tenki_external_cleanup_outbox_pending_idx
  ON tenki_external_cleanup_outbox(state,next_attempt_at)
  WHERE state IN ('pending','failed');

CREATE OR REPLACE FUNCTION enqueue_tenki_artifact_cleanup_before_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tenki_workspace_id IS NOT NULL AND (
    OLD.template_id IS NOT NULL OR OLD.snapshot_id IS NOT NULL
    OR OLD.registry_image_id IS NOT NULL
  ) THEN
    INSERT INTO tenki_external_cleanup_outbox(
      source_kind,source_id,tenki_workspace_id,ownership_token,provider_refs
    ) VALUES(
      'artifact',OLD.id,OLD.tenki_workspace_id,
      'artifact-' || substr(replace(OLD.id::text,'-',''),1,23),
      jsonb_build_object(
        'templateId',OLD.template_id,
        'buildId',OLD.build_id,
        'builderSessionId',OLD.builder_session_id,
        'snapshotId',OLD.snapshot_id,
        'registryImageId',OLD.registry_image_id
      )
    )
    ON CONFLICT(source_kind,source_id) DO UPDATE SET
      tenki_workspace_id=excluded.tenki_workspace_id,
      ownership_token=excluded.ownership_token,
      provider_refs=excluded.provider_refs,
      state='pending',attempts=0,next_attempt_at=now(),
      failure_reason=NULL,updated_at=now(),completed_at=NULL;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tenki_environment_artifacts_cleanup_outbox
  ON tenki_environment_artifacts;
CREATE TRIGGER tenki_environment_artifacts_cleanup_outbox
  BEFORE DELETE ON tenki_environment_artifacts
  FOR EACH ROW EXECUTE FUNCTION enqueue_tenki_artifact_cleanup_before_delete();

CREATE OR REPLACE FUNCTION enqueue_tenki_cache_cleanup_before_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tenki_volume_id IS NOT NULL THEN
    INSERT INTO tenki_external_cleanup_outbox(
      source_kind,source_id,tenki_workspace_id,ownership_token,provider_refs
    ) VALUES(
      'cache',OLD.id,OLD.tenki_workspace_id,
      'cache-' || substr(replace(OLD.id::text,'-',''),1,26),
      jsonb_build_object('volumeId',OLD.tenki_volume_id)
    )
    ON CONFLICT(source_kind,source_id) DO UPDATE SET
      tenki_workspace_id=excluded.tenki_workspace_id,
      ownership_token=excluded.ownership_token,
      provider_refs=excluded.provider_refs,
      state='pending',attempts=0,next_attempt_at=now(),
      failure_reason=NULL,updated_at=now(),completed_at=NULL;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tenki_dependency_cache_cleanup_outbox
  ON tenki_dependency_cache_volumes;
CREATE TRIGGER tenki_dependency_cache_cleanup_outbox
  BEFORE DELETE ON tenki_dependency_cache_volumes
  FOR EACH ROW EXECUTE FUNCTION enqueue_tenki_cache_cleanup_before_delete();
