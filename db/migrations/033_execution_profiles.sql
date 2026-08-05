CREATE TABLE IF NOT EXISTS execution_profile_versions (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repository text NOT NULL DEFAULT '',
  workspace_root text NOT NULL DEFAULT '.',
  version integer NOT NULL CHECK (version > 0),
  source text NOT NULL CHECK (source IN ('detected','confirmed','override','safe_generic')),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  parent_profile_id uuid,
  detection_evidence jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(detection_evidence) = 'object'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (repository = '' AND workspace_root = '.') OR
    (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
      AND workspace_root <> ''
      AND workspace_root !~ '^/'
      AND workspace_root !~ '(^|/)\.\.(/|$)')
  ),
  UNIQUE (org_id,id),
  UNIQUE (org_id,id,content_hash),
  UNIQUE (org_id,repository,workspace_root,id,content_hash),
  UNIQUE (org_id,repository,workspace_root,version),
  FOREIGN KEY (org_id,parent_profile_id)
    REFERENCES execution_profile_versions(org_id,id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS execution_profile_versions_scope_hash_idx
  ON execution_profile_versions(
    org_id,repository,workspace_root,source,content_hash
  );

CREATE OR REPLACE FUNCTION reject_execution_profile_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Permit privacy-driven tenant deletion through the organizations cascade,
    -- but reject deletion while the owning tenant still exists.
    IF EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
      RAISE EXCEPTION 'execution profile versions are immutable';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'execution profile versions are immutable';
END;
$$;

DROP TRIGGER IF EXISTS execution_profile_versions_immutable
  ON execution_profile_versions;
CREATE TRIGGER execution_profile_versions_immutable
  BEFORE UPDATE OR DELETE ON execution_profile_versions
  FOR EACH ROW EXECUTE FUNCTION reject_execution_profile_version_update();

CREATE TABLE IF NOT EXISTS execution_profile_assignments (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repository text NOT NULL DEFAULT '',
  workspace_root text NOT NULL DEFAULT '.',
  active_profile_id uuid,
  active_profile_hash text,
  detected_profile_id uuid,
  detected_profile_hash text,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,repository,workspace_root),
  CHECK (
    (repository = '' AND workspace_root = '.') OR
    (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
      AND workspace_root <> ''
      AND workspace_root !~ '^/'
      AND workspace_root !~ '(^|/)\.\.(/|$)')
  ),
  CHECK (
    (active_profile_id IS NULL AND active_profile_hash IS NULL) OR
    (active_profile_id IS NOT NULL AND active_profile_hash ~ '^[a-f0-9]{64}$')
  ),
  CHECK (
    (detected_profile_id IS NULL AND detected_profile_hash IS NULL) OR
    (detected_profile_id IS NOT NULL AND detected_profile_hash ~ '^[a-f0-9]{64}$')
  ),
  FOREIGN KEY (
    org_id,repository,workspace_root,active_profile_id,active_profile_hash
  ) REFERENCES execution_profile_versions(
    org_id,repository,workspace_root,id,content_hash
  ) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (
    org_id,repository,workspace_root,detected_profile_id,detected_profile_hash
  ) REFERENCES execution_profile_versions(
    org_id,repository,workspace_root,id,content_hash
  ) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS execution_profile_assignments_active_idx
  ON execution_profile_assignments(org_id,active_profile_id)
  WHERE active_profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS problem_repository_matches (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  repository text NOT NULL,
  workspace_root text NOT NULL DEFAULT '.',
  profile_id uuid NOT NULL,
  profile_hash text NOT NULL CHECK (profile_hash ~ '^[a-f0-9]{64}$'),
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  reasons jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(reasons) = 'array'),
  status text NOT NULL DEFAULT 'Suggested'
    CHECK (status IN ('Suggested','Confirmed','Rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,problem_id,repository,workspace_root),
  CHECK (
    repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
    AND workspace_root <> ''
    AND workspace_root !~ '^/'
    AND workspace_root !~ '(^|/)\.\.(/|$)'
  ),
  FOREIGN KEY (org_id,problem_id)
    REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,repository,workspace_root,profile_id,profile_hash)
    REFERENCES execution_profile_versions(
      org_id,repository,workspace_root,id,content_hash
    ) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS problem_repository_matches_ranking_idx
  ON problem_repository_matches(org_id,problem_id,status,confidence DESC);

CREATE UNIQUE INDEX IF NOT EXISTS problem_repository_matches_one_confirmed_idx
  ON problem_repository_matches(org_id,problem_id)
  WHERE status='Confirmed';

ALTER TABLE engineering_ticket_specifications
  ADD COLUMN IF NOT EXISTS execution_profile_id uuid,
  ADD COLUMN IF NOT EXISTS execution_profile_hash text,
  ADD COLUMN IF NOT EXISTS execution_profile_snapshot jsonb;

ALTER TABLE pdd_prompt_verifications
  ADD COLUMN IF NOT EXISTS execution_profile_id uuid,
  ADD COLUMN IF NOT EXISTS execution_profile_hash text,
  ADD COLUMN IF NOT EXISTS execution_profile_snapshot jsonb;

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS execution_profile_id uuid,
  ADD COLUMN IF NOT EXISTS execution_profile_hash text,
  ADD COLUMN IF NOT EXISTS execution_profile_snapshot jsonb;

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS execution_profile_id uuid,
  ADD COLUMN IF NOT EXISTS execution_profile_hash text,
  ADD COLUMN IF NOT EXISTS execution_profile_snapshot jsonb;

DO $$
DECLARE
  table_name text;
  constraint_prefix text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'engineering_ticket_specifications',
    'pdd_prompt_verifications',
    'approval_requests',
    'agent_runs'
  ]
  LOOP
    constraint_prefix := CASE table_name
      WHEN 'engineering_ticket_specifications' THEN 'ticket_specs'
      WHEN 'pdd_prompt_verifications' THEN 'pdd_verifications'
      WHEN 'approval_requests' THEN 'approval_requests'
      ELSE 'agent_runs'
    END;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = constraint_prefix || '_execution_profile_binding_ck'
         AND conrelid = table_name::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (
          (execution_profile_id IS NULL
            AND execution_profile_hash IS NULL
            AND execution_profile_snapshot IS NULL)
          OR
          (execution_profile_id IS NOT NULL
            AND execution_profile_hash ~ ''^[a-f0-9]{64}$''
            AND jsonb_typeof(execution_profile_snapshot) = ''object'')
        )',
        table_name,
        constraint_prefix || '_execution_profile_binding_ck'
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = constraint_prefix || '_execution_profile_fk'
         AND conrelid = table_name::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I
          FOREIGN KEY (org_id,execution_profile_id,execution_profile_hash)
          REFERENCES execution_profile_versions(org_id,id,content_hash)
          ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED',
        table_name,
        constraint_prefix || '_execution_profile_fk'
      );
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION reject_execution_profile_binding_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.execution_profile_id IS NOT NULL AND (
    NEW.execution_profile_id IS DISTINCT FROM OLD.execution_profile_id OR
    NEW.execution_profile_hash IS DISTINCT FROM OLD.execution_profile_hash OR
    NEW.execution_profile_snapshot IS DISTINCT FROM OLD.execution_profile_snapshot
  ) THEN
    RAISE EXCEPTION 'an execution profile binding is immutable once recorded';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ticket_specs_execution_profile_immutable
  ON engineering_ticket_specifications;
CREATE TRIGGER ticket_specs_execution_profile_immutable
  BEFORE UPDATE ON engineering_ticket_specifications
  FOR EACH ROW EXECUTE FUNCTION reject_execution_profile_binding_change();

DROP TRIGGER IF EXISTS pdd_verifications_execution_profile_immutable
  ON pdd_prompt_verifications;
CREATE TRIGGER pdd_verifications_execution_profile_immutable
  BEFORE UPDATE ON pdd_prompt_verifications
  FOR EACH ROW EXECUTE FUNCTION reject_execution_profile_binding_change();

DROP TRIGGER IF EXISTS approval_requests_execution_profile_immutable
  ON approval_requests;
CREATE TRIGGER approval_requests_execution_profile_immutable
  BEFORE UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION reject_execution_profile_binding_change();

DROP TRIGGER IF EXISTS agent_runs_execution_profile_immutable
  ON agent_runs;
CREATE TRIGGER agent_runs_execution_profile_immutable
  BEFORE UPDATE ON agent_runs
  FOR EACH ROW EXECUTE FUNCTION reject_execution_profile_binding_change();
