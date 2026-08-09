ALTER TABLE pipedream_connections
  ADD COLUMN IF NOT EXISTS import_cursor text,
  ADD COLUMN IF NOT EXISTS import_generation bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS import_claimed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='pipedream_connections_import_generation_check'
  ) THEN
    ALTER TABLE pipedream_connections
      ADD CONSTRAINT pipedream_connections_import_generation_check
      CHECK (import_generation >= 0);
  END IF;
END $$;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS arr_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS arr_source_priority smallint NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS arr_source_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS profile_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS profile_source_priority smallint NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS profile_source_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS customer_since_known boolean NOT NULL DEFAULT true;

UPDATE accounts
   SET origin='demo',arr_source='demo',arr_source_priority=10,
       profile_source='demo',profile_source_priority=10
 WHERE id LIKE 'acct_demo_%'
    OR org_id='org_northstar';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='accounts_origin_check'
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_origin_check
      CHECK (origin IN ('demo','manual','integration'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='accounts_arr_source_priority_check'
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_arr_source_priority_check
      CHECK (arr_source_priority BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='accounts_profile_source_priority_check'
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_profile_source_priority_check
      CHECK (profile_source_priority BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='accounts_arr_source_check'
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_arr_source_check
      CHECK (arr_source IN (
        'unknown','demo','manual','zendesk','webhook','crm','billing'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='accounts_profile_source_check'
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_profile_source_check
      CHECK (profile_source IN (
        'unknown','demo','manual','zendesk','webhook','crm','billing'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS accounts_non_demo_org_idx
  ON accounts(org_id) WHERE origin <> 'demo';

CREATE INDEX IF NOT EXISTS problem_account_impacts_account_idx
  ON problem_account_impacts(org_id,account_id,problem_id);

CREATE TABLE IF NOT EXISTS account_source_links (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  source_namespace text NOT NULL DEFAULT 'direct',
  external_account_id text NOT NULL,
  account_id text NOT NULL,
  source_name text NOT NULL,
  source_domain text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,integration_id,source_namespace,external_account_id),
  FOREIGN KEY (org_id,account_id)
    REFERENCES accounts(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id,integration_id)
    REFERENCES integrations(org_id,id) ON DELETE RESTRICT,
  CHECK (char_length(source_namespace) BETWEEN 1 AND 255),
  CHECK (char_length(external_account_id) BETWEEN 1 AND 512),
  CHECK (char_length(source_name) BETWEEN 1 AND 160)
);

CREATE INDEX IF NOT EXISTS account_source_links_account_idx
  ON account_source_links(org_id,account_id);

ALTER TABLE feedback_items
  ADD COLUMN IF NOT EXISTS account_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='feedback_items_account_fk'
  ) THEN
    ALTER TABLE feedback_items ADD CONSTRAINT feedback_items_account_fk
      FOREIGN KEY (org_id,account_id)
      REFERENCES accounts(org_id,id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS feedback_items_account_idx
  ON feedback_items(org_id,account_id,created_at DESC)
  WHERE account_id IS NOT NULL;

-- Historical display names are not stable customer identifiers. Existing
-- feedback remains unlinked until a trusted source identity explicitly links
-- it to an account.

ALTER TABLE problem_account_impacts
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='problem_account_impacts_origin_check'
  ) THEN
    ALTER TABLE problem_account_impacts
      ADD CONSTRAINT problem_account_impacts_origin_check
      CHECK (origin IN ('manual','feedback'));
  END IF;
END $$;

INSERT INTO problem_account_impacts(org_id,problem_id,account_id,origin)
SELECT membership.org_id,membership.problem_id,feedback.account_id,'feedback'
  FROM feedback_cluster_memberships membership
  JOIN feedback_items feedback
    ON feedback.org_id=membership.org_id
   AND feedback.id=membership.feedback_id
 WHERE feedback.account_id IS NOT NULL
ON CONFLICT (org_id,problem_id,account_id) DO NOTHING;

CREATE OR REPLACE FUNCTION refresh_feedback_problem_account_impact(
  target_org_id text,
  target_problem_id text,
  target_account_id text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF target_account_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM feedback_cluster_memberships membership
      JOIN feedback_items feedback
        ON feedback.org_id=membership.org_id
       AND feedback.id=membership.feedback_id
     WHERE membership.org_id=target_org_id
       AND membership.problem_id=target_problem_id
       AND feedback.account_id=target_account_id
  ) THEN
    INSERT INTO problem_account_impacts(org_id,problem_id,account_id,origin)
    VALUES(target_org_id,target_problem_id,target_account_id,'feedback')
    ON CONFLICT (org_id,problem_id,account_id) DO NOTHING;
  ELSE
    DELETE FROM problem_account_impacts
     WHERE org_id=target_org_id
       AND problem_id=target_problem_id
       AND account_id=target_account_id
       AND origin='feedback';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION sync_membership_account_impact()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  linked_account_id text;
BEGIN
  IF TG_OP IN ('DELETE','UPDATE') THEN
    SELECT account_id INTO linked_account_id
      FROM feedback_items
     WHERE org_id=OLD.org_id AND id=OLD.feedback_id;
    PERFORM refresh_feedback_problem_account_impact(
      OLD.org_id,OLD.problem_id,linked_account_id
    );
  END IF;

  IF TG_OP IN ('INSERT','UPDATE') THEN
    SELECT account_id INTO linked_account_id
      FROM feedback_items
     WHERE org_id=NEW.org_id AND id=NEW.feedback_id;
    PERFORM refresh_feedback_problem_account_impact(
      NEW.org_id,NEW.problem_id,linked_account_id
    );
  END IF;
  IF TG_OP='DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS feedback_membership_account_impact
  ON feedback_cluster_memberships;
CREATE TRIGGER feedback_membership_account_impact
AFTER INSERT OR UPDATE OR DELETE ON feedback_cluster_memberships
FOR EACH ROW EXECUTE FUNCTION sync_membership_account_impact();

CREATE OR REPLACE FUNCTION sync_feedback_account_impacts()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  membership record;
BEGIN
  IF OLD.account_id IS NOT DISTINCT FROM NEW.account_id THEN
    RETURN NEW;
  END IF;

  FOR membership IN
    SELECT problem_id
      FROM feedback_cluster_memberships
     WHERE org_id=NEW.org_id AND feedback_id=NEW.id
  LOOP
    PERFORM refresh_feedback_problem_account_impact(
      NEW.org_id,membership.problem_id,OLD.account_id
    );
    PERFORM refresh_feedback_problem_account_impact(
      NEW.org_id,membership.problem_id,NEW.account_id
    );
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS feedback_account_impact
  ON feedback_items;
CREATE TRIGGER feedback_account_impact
AFTER UPDATE OF account_id ON feedback_items
FOR EACH ROW EXECUTE FUNCTION sync_feedback_account_impacts();

-- The membership rows are removed by cascade after their parent feedback row.
-- Capture the old account while both are still visible and remove an impact
-- only when no other feedback from that account supports the same problem.
CREATE OR REPLACE FUNCTION cleanup_deleted_feedback_account_impacts()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  linked_problem_id text;
BEGIN
  IF OLD.account_id IS NULL THEN
    RETURN OLD;
  END IF;

  FOR linked_problem_id IN
    SELECT membership.problem_id
      FROM feedback_cluster_memberships membership
     WHERE membership.org_id=OLD.org_id
       AND membership.feedback_id=OLD.id
  LOOP
    DELETE FROM problem_account_impacts impact
     WHERE impact.org_id=OLD.org_id
       AND impact.problem_id=linked_problem_id
       AND impact.account_id=OLD.account_id
       AND impact.origin='feedback'
       AND NOT EXISTS (
         SELECT 1
           FROM feedback_cluster_memberships other_membership
           JOIN feedback_items other_feedback
             ON other_feedback.org_id=other_membership.org_id
            AND other_feedback.id=other_membership.feedback_id
          WHERE other_membership.org_id=OLD.org_id
            AND other_membership.problem_id=linked_problem_id
            AND other_membership.feedback_id <> OLD.id
            AND other_feedback.account_id=OLD.account_id
       );
  END LOOP;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS feedback_delete_account_impact
  ON feedback_items;
CREATE TRIGGER feedback_delete_account_impact
BEFORE DELETE ON feedback_items
FOR EACH ROW EXECUTE FUNCTION cleanup_deleted_feedback_account_impacts();
