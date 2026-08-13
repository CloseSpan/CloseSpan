CREATE TABLE IF NOT EXISTS pdd_prompt_evaluations (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  specification_id uuid NOT NULL,
  specification_revision integer NOT NULL CHECK (specification_revision > 0),
  prompt_revision_id uuid NOT NULL,
  prompt_hash text NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  user_story text NOT NULL,
  story_hash text NOT NULL CHECK (story_hash ~ '^[a-f0-9]{64}$'),
  trigger_source text NOT NULL CHECK (trigger_source IN ('automatic','manual')),
  status text NOT NULL CHECK (status IN ('Running','Succeeded','Failed')),
  review jsonb,
  failure_message text,
  applied_prompt_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (org_id,problem_id)
    REFERENCES product_problems(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,specification_id)
    REFERENCES engineering_ticket_specifications(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,prompt_revision_id)
    REFERENCES implementation_prompts(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id,applied_prompt_revision_id)
    REFERENCES implementation_prompts(org_id,id) ON DELETE RESTRICT,
  UNIQUE (org_id,id)
);

CREATE UNIQUE INDEX IF NOT EXISTS pdd_prompt_evaluations_automatic_once_idx
  ON pdd_prompt_evaluations(
    org_id,
    problem_id,
    specification_id,
    specification_revision
  )
  WHERE trigger_source='automatic';

CREATE INDEX IF NOT EXISTS pdd_prompt_evaluations_problem_idx
  ON pdd_prompt_evaluations(org_id,problem_id,created_at DESC);

-- Existing immutable revision chains predate durable PDD run tracking. Mark the
-- current revised prompt as already handled so opening an old ticket cannot
-- restart the automatic evaluator after this migration ships.
INSERT INTO pdd_prompt_evaluations(
  id,org_id,problem_id,specification_id,specification_revision,
  prompt_revision_id,prompt_hash,user_story,story_hash,trigger_source,
  status,created_at,completed_at
)
SELECT
  gen_random_uuid(),prompt.org_id,prompt.problem_id,prompt.specification_id,
  prompt.specification_revision,prompt.id,prompt.content_hash,specification.user_story,
  prompt.content_hash,
  'automatic','Succeeded',prompt.created_at,prompt.created_at
FROM implementation_prompts prompt
JOIN engineering_ticket_specifications specification
  ON specification.org_id=prompt.org_id AND specification.id=prompt.specification_id
WHERE prompt.status <> 'Superseded'
  AND prompt.revision > 1
ON CONFLICT (org_id,problem_id,specification_id,specification_revision)
  WHERE trigger_source='automatic'
DO NOTHING;
