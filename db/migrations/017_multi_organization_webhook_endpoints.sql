ALTER TABLE integration_webhook_secrets
  ADD COLUMN IF NOT EXISTS public_id text;

UPDATE integration_webhook_secrets
   SET public_id = 'whk_' || replace(gen_random_uuid()::text, '-', '')
 WHERE public_id IS NULL;

ALTER TABLE integration_webhook_secrets
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS integration_webhook_secrets_public_id_idx
  ON integration_webhook_secrets(public_id);
