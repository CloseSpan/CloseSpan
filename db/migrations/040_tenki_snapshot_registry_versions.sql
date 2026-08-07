ALTER TABLE tenki_environment_artifacts
  DROP CONSTRAINT IF EXISTS tenki_environment_artifacts_registry_digest_ref_check;

ALTER TABLE tenki_environment_artifacts
  ADD CONSTRAINT tenki_environment_artifacts_registry_digest_ref_check
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
  );
