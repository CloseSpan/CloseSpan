ALTER TABLE pdd_prompt_evaluations
  ADD COLUMN IF NOT EXISTS acceptance_preparation_failure_message text;
