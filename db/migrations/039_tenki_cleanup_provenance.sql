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
