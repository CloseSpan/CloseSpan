-- Keep external record identity local to the connector stream. Different
-- Nango models and syncs commonly reuse simple IDs (for example "42").
ALTER TABLE feedback_items
  ADD COLUMN IF NOT EXISTS source_namespace text NOT NULL DEFAULT 'direct';

ALTER TABLE feedback_items
  DROP CONSTRAINT IF EXISTS feedback_items_source_namespace_length;
ALTER TABLE feedback_items
  ADD CONSTRAINT feedback_items_source_namespace_length
  CHECK (char_length(source_namespace) BETWEEN 1 AND 255);

-- Preserve the stream identity of feedback already ingested before this
-- migration. If historical collisions already overwrote a row, the original
-- provider payload cannot be reconstructed; subsequent syncs recreate it.
UPDATE feedback_items feedback
   SET source_namespace='nango:' || receipt.cursor_id::text
  FROM nango_sync_record_receipts receipt
 WHERE receipt.org_id=feedback.org_id
   AND receipt.integration_id=feedback.integration_id
   AND receipt.feedback_id=feedback.id
   AND feedback.source_namespace='direct';

DROP INDEX IF EXISTS feedback_items_external_dedup_idx;
CREATE UNIQUE INDEX IF NOT EXISTS feedback_items_external_stream_dedup_idx
  ON feedback_items(org_id, integration_id, source_namespace, external_id)
  WHERE external_id IS NOT NULL;

-- A yielded page goes to the back of the queue without changing the original
-- queued_at timestamp shown in status history.
ALTER TABLE nango_sync_jobs
  ADD COLUMN IF NOT EXISTS queue_order_at timestamptz NOT NULL DEFAULT now();

DROP INDEX IF EXISTS nango_sync_jobs_claim_idx;
CREATE INDEX IF NOT EXISTS nango_sync_jobs_claim_idx
  ON nango_sync_jobs(status, available_at, queue_order_at)
  WHERE status IN ('Queued', 'Retrying', 'Running');
