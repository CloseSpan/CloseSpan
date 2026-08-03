-- Some early deployments created a generic `(scope,key)` idempotency table
-- before CloseSpan standardized this store around workspaces and actions. Keep
-- that legacy row set intact for audit/debugging, then create the schema the
-- current repositories use. New databases already have the canonical shape
-- from 001_initial.sql and skip this compatibility block.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'idempotency_keys'
  ) AND NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'idempotency_keys'
       AND column_name = 'org_id'
  ) THEN
    ALTER TABLE idempotency_keys RENAME TO idempotency_keys_legacy_scope;
    ALTER TABLE idempotency_keys_legacy_scope
      RENAME CONSTRAINT idempotency_keys_pkey TO idempotency_keys_legacy_scope_pkey;

    CREATE TABLE idempotency_keys (
      org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      key text NOT NULL,
      action text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (org_id,key)
    );
  END IF;
END;
$migration$;
