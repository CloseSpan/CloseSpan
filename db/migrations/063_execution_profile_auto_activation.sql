ALTER TABLE execution_profile_assignments
  ADD COLUMN IF NOT EXISTS automatic_activation_disabled boolean NOT NULL DEFAULT false;
