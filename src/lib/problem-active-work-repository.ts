import { databasePool } from "./db";
import type {
  ProblemActiveWork,
  ProblemActiveWorkStatus,
} from "./problem-active-work";
import { workspacePersistenceMode } from "./workspace-persistence";

interface ProblemActiveWorkRow {
  problem_id: string;
  status: ProblemActiveWorkStatus;
  started_at: Date | string;
}

/**
 * Returns at most one active workflow phase per problem. Later lifecycle work
 * wins when two durable workers overlap, so cards never show conflicting
 * statuses or multiple spinners.
 */
export async function readProblemActiveWork(
  orgId: string,
): Promise<ProblemActiveWork[]> {
  if (workspacePersistenceMode(orgId) === "memory") return [];

  const result = await databasePool().query<ProblemActiveWorkRow>(
    `WITH active_work AS (
       SELECT verification.problem_id,
              'Verifying'::text AS status,
              10 AS priority,
              coalesce(verification.started_at,verification.queued_at) AS started_at
         FROM post_release_verification_jobs verification
        WHERE verification.org_id=$1
          AND verification.status IN ('Queued','Running')

       UNION ALL

       SELECT release.problem_id,
              'Deploying'::text AS status,
              20 AS priority,
              release.occurred_at AS started_at
         FROM release_events release
        WHERE release.org_id=$1
          AND release.status IN ('Pending','Running')

       UNION ALL

       SELECT run.problem_id,
              CASE attempt.action
                WHEN 'deploy' THEN 'Deploying'
                ELSE 'Merging'
              END AS status,
              30 AS priority,
              coalesce(attempt.started_at,attempt.created_at) AS started_at
         FROM final_execution_attempts attempt
         JOIN agent_runs run
           ON run.org_id=attempt.org_id AND run.id=attempt.agent_run_id
        WHERE attempt.org_id=$1
          AND attempt.status IN ('Queued','Running')

       UNION ALL

       SELECT run.problem_id,
              CASE
                WHEN run.status='Queued' THEN 'Queued'
                WHEN run.sandbox_id ~* '^(github|actions|gha):' THEN 'CI'
                WHEN run.sandbox_id LIKE 'tenki:%' THEN 'Tenki'
                ELSE 'Working'
              END AS status,
              40 AS priority,
              coalesce(run.started_at,run.queued_at) AS started_at
         FROM agent_runs run
        WHERE run.org_id=$1
          AND run.status IN ('Queued','Running')

       UNION ALL

       SELECT verification.problem_id,
              'Testing'::text AS status,
              50 AS priority,
              coalesce(verification.started_at,verification.created_at) AS started_at
         FROM pdd_prompt_verifications verification
        WHERE verification.org_id=$1
          AND verification.status IN ('Queued','Generating tests')
     )
     SELECT DISTINCT ON (problem_id) problem_id,status,started_at
       FROM active_work
      ORDER BY problem_id,priority,started_at DESC`,
    [orgId],
  );

  return result.rows.map((row) => ({
    problemId: row.problem_id,
    status: row.status,
    startedAt:
      row.started_at instanceof Date
        ? row.started_at.toISOString()
        : new Date(row.started_at).toISOString(),
  }));
}
