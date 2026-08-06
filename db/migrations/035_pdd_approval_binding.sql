ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS pdd_verification_id uuid;

-- Preserve the exact PDD contract for runs that already consumed an approval.
UPDATE approval_requests approval
   SET pdd_verification_id=run.pdd_verification_id
  FROM agent_runs run
 WHERE approval.org_id=run.org_id
   AND approval.id=run.approval_id
   AND approval.action_type='agent_run'
   AND approval.pdd_verification_id IS NULL
   AND run.pdd_verification_id IS NOT NULL;

-- Backfill unconsumed legacy approvals only when their one active contract is
-- still an exact prompt match. The active-verification unique index makes this
-- join unambiguous per problem.
UPDATE approval_requests approval
   SET pdd_verification_id=verification.id
  FROM pdd_prompt_verifications verification
 WHERE approval.org_id=verification.org_id
   AND approval.problem_id=verification.problem_id
   AND approval.prompt_revision_id=verification.prompt_revision_id
   AND approval.prompt_hash=verification.prompt_hash
   AND approval.action_type='agent_run'
   AND approval.pdd_verification_id IS NULL
   AND approval.status='Pending'
   AND verification.status='Ready for approval';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname='approval_requests_pdd_verification_fk'
       AND conrelid='approval_requests'::regclass
  ) THEN
    ALTER TABLE approval_requests
      ADD CONSTRAINT approval_requests_pdd_verification_fk
      FOREIGN KEY (org_id,pdd_verification_id)
      REFERENCES pdd_prompt_verifications(org_id,id) ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS approval_requests_pdd_verification_idx
  ON approval_requests(org_id,pdd_verification_id)
  WHERE pdd_verification_id IS NOT NULL;

-- Historical Ready contracts remain attached to their approval/run. Only work
-- that is still being generated must be globally unique for a problem.
DROP INDEX IF EXISTS pdd_prompt_verifications_active_idx;
CREATE UNIQUE INDEX pdd_prompt_verifications_active_idx
  ON pdd_prompt_verifications(org_id,problem_id)
  WHERE status IN ('Queued','Generating tests');

CREATE OR REPLACE FUNCTION reject_completed_pdd_artifact_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status='Ready for approval'
     AND NEW.status NOT IN ('Ready for approval','Superseded') THEN
    RAISE EXCEPTION 'a ready PDD acceptance contract can only be superseded';
  END IF;
  IF OLD.status='Superseded' AND NEW.status <> 'Superseded' THEN
    RAISE EXCEPTION 'a superseded PDD acceptance contract cannot be reopened';
  END IF;
  IF OLD.status IN ('Ready for approval','Superseded') AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.org_id IS DISTINCT FROM OLD.org_id OR
    NEW.problem_id IS DISTINCT FROM OLD.problem_id OR
    NEW.prompt_revision_id IS DISTINCT FROM OLD.prompt_revision_id OR
    NEW.prompt_hash IS DISTINCT FROM OLD.prompt_hash OR
    NEW.user_story IS DISTINCT FROM OLD.user_story OR
    NEW.story_hash IS DISTINCT FROM OLD.story_hash OR
    NEW.pdd_version IS DISTINCT FROM OLD.pdd_version OR
    NEW.model IS DISTINCT FROM OLD.model OR
    NEW.budget_usd IS DISTINCT FROM OLD.budget_usd OR
    NEW.cost_usd IS DISTINCT FROM OLD.cost_usd OR
    NEW.summary IS DISTINCT FROM OLD.summary OR
    NEW.generated_tests IS DISTINCT FROM OLD.generated_tests OR
    NEW.failure_message IS DISTINCT FROM OLD.failure_message OR
    NEW.created_by IS DISTINCT FROM OLD.created_by OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.started_at IS DISTINCT FROM OLD.started_at OR
    NEW.completed_at IS DISTINCT FROM OLD.completed_at OR
    NEW.execution_profile_id IS DISTINCT FROM OLD.execution_profile_id OR
    NEW.execution_profile_hash IS DISTINCT FROM OLD.execution_profile_hash OR
    NEW.execution_profile_snapshot IS DISTINCT FROM OLD.execution_profile_snapshot
  ) THEN
    RAISE EXCEPTION 'a completed PDD acceptance contract is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pdd_verifications_artifact_immutable
  ON pdd_prompt_verifications;
CREATE TRIGGER pdd_verifications_artifact_immutable
  BEFORE UPDATE ON pdd_prompt_verifications
  FOR EACH ROW EXECUTE FUNCTION reject_completed_pdd_artifact_change();

CREATE OR REPLACE FUNCTION reject_pdd_approval_binding_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.pdd_verification_id IS NOT NULL
     AND NEW.pdd_verification_id IS DISTINCT FROM OLD.pdd_verification_id THEN
    RAISE EXCEPTION 'a PDD approval binding is immutable once recorded';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS approval_requests_pdd_verification_immutable
  ON approval_requests;
CREATE TRIGGER approval_requests_pdd_verification_immutable
  BEFORE UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION reject_pdd_approval_binding_change();

CREATE OR REPLACE FUNCTION enforce_agent_run_pdd_approval_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  approval_pdd_verification_id uuid;
BEGIN
  IF TG_OP='UPDATE'
     AND OLD.pdd_verification_id IS NOT NULL
     AND NEW.pdd_verification_id IS DISTINCT FROM OLD.pdd_verification_id THEN
    RAISE EXCEPTION 'an agent run PDD binding is immutable once recorded';
  END IF;

  IF NEW.pdd_verification_id IS NULL THEN
    RAISE EXCEPTION 'a new agent run requires an approval-bound PDD verification';
  END IF;

  SELECT approval.pdd_verification_id
    INTO approval_pdd_verification_id
    FROM approval_requests approval
   WHERE approval.org_id=NEW.org_id
     AND approval.id=NEW.approval_id
     AND approval.action_type='agent_run';

  IF approval_pdd_verification_id IS NULL
     OR approval_pdd_verification_id IS DISTINCT FROM NEW.pdd_verification_id THEN
    RAISE EXCEPTION 'an agent run must use its approval-bound PDD verification';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_runs_pdd_approval_binding_insert
  ON agent_runs;
CREATE TRIGGER agent_runs_pdd_approval_binding_insert
  BEFORE INSERT ON agent_runs
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_run_pdd_approval_binding();

DROP TRIGGER IF EXISTS agent_runs_pdd_approval_binding_update
  ON agent_runs;
CREATE TRIGGER agent_runs_pdd_approval_binding_update
  BEFORE UPDATE OF org_id,approval_id,pdd_verification_id ON agent_runs
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_run_pdd_approval_binding();
