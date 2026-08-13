ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS prompt_evaluation_mode text NOT NULL
  DEFAULT 'pdd_cloud_with_local_fallback';

ALTER TABLE workspace_settings
  DROP CONSTRAINT IF EXISTS workspace_settings_prompt_evaluation_mode_check;

ALTER TABLE workspace_settings
  ADD CONSTRAINT workspace_settings_prompt_evaluation_mode_check
  CHECK (prompt_evaluation_mode IN (
    'pdd_cloud',
    'pdd_local',
    'pdd_cloud_with_local_fallback'
  ));
