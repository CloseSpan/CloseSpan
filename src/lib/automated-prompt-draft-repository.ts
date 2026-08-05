import { createAutomatedPromptDraft } from "./engineering-workflow-repository";
import type { EngineeringTicketSpecification, PromptEvidence } from "./engineering-prompt";
import { databasePool } from "./db";
import { createGithubInstallationClient } from "./github-app-auth";
import {
  assessPromptDraftEligibility,
  type PromptDraftCandidateEvidence,
  type PromptDraftPolicy,
} from "./prompt-draft-policy";
import { primaryProblem, recommendation } from "./seed";
import { workspacePersistenceMode } from "./workspace-persistence";
import { readPromptDraftPolicy } from "./workspace-settings-repository";
import { refreshPendingProblemRepositoryMatches } from "./problem-repository-match-repository";
import {
  assertExecutionProfileNarrowing,
  sanitizeExecutionProfileConfig,
} from "./execution-profile";

interface DraftCandidateRow {
  id: string;
  title: string;
  statement: string;
  summary: string;
  severity: string;
  confidence: number;
  product_area: string;
  team: string;
  suspected_repository: string;
  suspected_files: string[];
  evidence_count: number;
  bug_count: number;
  feature_count: number;
  hypothesis: string;
  investigation_confidence: number;
  assumptions: string[];
  missing_information: string[];
  proposed_action: string;
  recommended_tests: string[];
  repository: string | null;
  default_branch: string | null;
  installation_id: string | null;
  execution_profile_config: unknown;
}

export interface AutomatedPromptDraftResult {
  created: boolean;
  problemId: string | null;
  promptId: string | null;
  reason: string;
}

function feedbackKind(row: Pick<DraftCandidateRow, "bug_count" | "feature_count">): PromptDraftCandidateEvidence["kind"] {
  if (row.feature_count > row.bug_count) return "Feature request";
  if (row.bug_count > 0) return "Bug";
  return "Other";
}

function concise(value: string, fallback: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return (normalized || fallback).slice(0, 1_900);
}

export function buildAutomatedEngineeringDraft(input: {
  kind: "Bug" | "Feature request";
  title: string;
  statement: string;
  summary: string;
  proposedAction: string;
  recommendedTests: string[];
  suspectedFiles: string[];
  repository: string;
  baseBranch: string;
  baseSha: string;
  evidenceCount: number;
  executionProfileConfig?: unknown;
}): EngineeringTicketSpecification {
  const expected = concise(input.proposedAction, `Deliver the reviewed outcome for ${input.title}.`);
  const outcome = concise(input.summary, `Customers can use ${input.title} without the reported limitation.`);
  const storyGoal = input.kind === "Bug"
    ? `the reported ${input.title.toLowerCase()} behavior to be corrected`
    : `${input.title.toLowerCase()} to be available`;
  const criteriaSource = input.recommendedTests.length
    ? input.recommendedTests.slice(0, 10)
    : [`The reviewed solution delivers the expected behavior for all ${input.evidenceCount} grouped reports.`];
  const acceptanceCriteria = criteriaSource.map((statement, index) => ({
    id: `AC-${index + 1}`,
    statement: concise(statement, `The expected behavior is verifiably delivered for ${input.title}.`),
    measurable: true,
  }));
  const testScenarios = acceptanceCriteria.map((criterion, index) => ({
    id: `TEST-${index + 1}`,
    title: `Verify ${criterion.id} for ${input.title}`.slice(0, 200),
    given: `${input.evidenceCount} grouped customer reports and an isolated test fixture`,
    when: "The suggested solution is applied and the relevant workflow is exercised",
    then: criterion.statement,
    testLevel: "integration" as const,
    criterionIds: [criterion.id],
  }));
  let paths = [...new Set([...input.suspectedFiles.filter(Boolean), "tests/**"])]
    .slice(0, 100);
  let requiredCommands = ["npm test", "npm run typecheck"];
  if (input.executionProfileConfig) {
    const config = sanitizeExecutionProfileConfig(input.executionProfileConfig);
    const generatedTestPath = config.workingDirectory === "."
      ? "tests/**"
      : `${config.workingDirectory}/tests/**`;
    paths = [...new Set([...input.suspectedFiles.filter(Boolean), generatedTestPath])]
      .filter((path) => {
        try {
          assertExecutionProfileNarrowing(config, {
            permittedPaths: [path],
            requiredCommands: [],
          });
          return true;
        } catch {
          return false;
        }
      })
      .slice(0, 100);
    requiredCommands = [
      ...config.testCommands,
      ...config.typecheckCommands,
    ].slice(0, 30);
  }
  return {
    implementationState: "Draft specification",
    userStory: `As a product user, I want ${storyGoal}, so that ${outcome.replace(/[.]$/, "").toLowerCase()}.`,
    currentBehavior: concise(input.statement, `${input.title} is not meeting the reported customer need.`),
    expectedBehavior: expected,
    reproductionSteps: [
      `Review the ${input.evidenceCount} grouped and redacted customer reports.`,
      input.kind === "Bug"
        ? "Reproduce the common failure mode in an isolated test environment."
        : "Exercise the current workflow and confirm the requested capability is absent.",
    ],
    businessOutcome: outcome,
    acceptanceCriteria,
    testScenarios,
    regressionScenarios: criteriaSource,
    negativeScenarios: ["Existing supported behavior remains unchanged outside the reviewed scope."],
    qualityExpectations: [
      "Do not copy raw customer content, credentials, or production data into tests or logs.",
      "Keep the implementation inside explicitly permitted paths and preserve existing public contracts unless the specification requires a change.",
    ],
    requiredTestLevels: ["integration"],
    releaseVerification: `After deployment, verify ${input.title} with production-safe synthetic data and confirm the expected telemetry.`,
    nonGoals: ["Automatic merge or deployment.", "Changes outside the reviewed problem and permitted paths."],
    permittedPaths: paths,
    requiredCommands,
    repository: input.repository,
    baseBranch: input.baseBranch || "main",
    baseSha: input.baseSha,
  };
}

async function resolveBaseSha(row: DraftCandidateRow): Promise<string> {
  if (!row.installation_id || !row.repository || !row.default_branch) return "";
  try {
    const [owner, repo, ...rest] = row.repository.split("/");
    if (!owner || !repo || rest.length) return "";
    const github = await createGithubInstallationClient(row.installation_id);
    const ref = await github.rest.git.getRef({ owner, repo, ref: `heads/${row.default_branch}` });
    return /^[a-f0-9]{40}$/i.test(ref.data.object.sha) ? ref.data.object.sha.toLowerCase() : "";
  } catch {
    return "";
  }
}

function promptEvidence(row: DraftCandidateRow, redactedEvidence: PromptEvidence["redactedEvidence"]): PromptEvidence {
  return {
    problemId: row.id,
    title: row.title,
    statement: row.statement,
    summary: row.summary,
    severity: row.severity,
    productArea: row.product_area,
    team: row.team,
    hypothesis: row.hypothesis,
    assumptions: row.assumptions ?? [],
    missingInformation: row.missing_information ?? [],
    suspectedFiles: row.suspected_files ?? [],
    redactedEvidence,
  };
}

async function nextPostgresCandidate(orgId: string, policy: PromptDraftPolicy): Promise<DraftCandidateRow | null> {
  const result = await databasePool().query<DraftCandidateRow>(
    `SELECT problem.id,problem.title,problem.statement,problem.summary,problem.severity,
            problem.confidence,problem.product_area,problem.team,problem.suspected_repository,
            problem.suspected_files,count(membership.feedback_id)::int AS evidence_count,
            count(*) FILTER (WHERE feedback.type IN ('Bug','Incident'))::int AS bug_count,
            count(*) FILTER (WHERE feedback.type='Feature request')::int AS feature_count,
            investigation.hypothesis,investigation.confidence AS investigation_confidence,
            investigation.assumptions,investigation.missing_information,
            investigation.proposed_action,investigation.recommended_tests,
            repository.repository,repository.default_branch,repository.installation_id::text,
            repository.execution_profile_config
       FROM product_problems problem
       JOIN feedback_cluster_memberships membership
         ON membership.org_id=problem.org_id AND membership.problem_id=problem.id
       JOIN feedback_items feedback
         ON feedback.org_id=membership.org_id AND feedback.id=membership.feedback_id
       JOIN LATERAL (
         SELECT candidate.hypothesis,candidate.confidence,candidate.assumptions,
                candidate.missing_information,candidate.proposed_action,candidate.recommended_tests
           FROM investigations candidate
          WHERE candidate.org_id=problem.org_id AND candidate.problem_id=problem.id
          ORDER BY candidate.updated_at DESC,candidate.id LIMIT 1
       ) investigation ON true
       LEFT JOIN LATERAL (
         SELECT allowed.repository,allowed.default_branch,allowed.installation_id,
                bound_profile.config AS execution_profile_config
           FROM github_repository_allowlists allowed
           LEFT JOIN problem_repository_matches match
             ON match.org_id=problem.org_id
            AND match.problem_id=problem.id
            AND match.repository=allowed.repository
            AND match.status IN ('Confirmed','Suggested')
           LEFT JOIN LATERAL (
             SELECT profile.config
               FROM execution_profile_versions profile
              WHERE profile.org_id=problem.org_id
                AND profile.id=COALESCE(
                  match.profile_id,
                  (
                    SELECT COALESCE(assignment.active_profile_id,assignment.detected_profile_id)
                      FROM execution_profile_assignments assignment
                     WHERE assignment.org_id=problem.org_id
                       AND assignment.repository=allowed.repository
                     ORDER BY
                       (assignment.active_profile_id IS NOT NULL) DESC,
                       (assignment.workspace_root='.') DESC,
                       length(assignment.workspace_root) DESC
                     LIMIT 1
                  )
                )
              LIMIT 1
           ) bound_profile ON true
          WHERE allowed.org_id=problem.org_id AND allowed.active=true
            AND (
              match.status='Confirmed'
              OR (
                NOT EXISTS (
                  SELECT 1 FROM problem_repository_matches rejected
                   WHERE rejected.org_id=problem.org_id
                     AND rejected.problem_id=problem.id
                     AND rejected.repository=allowed.repository
                     AND rejected.status='Rejected'
                )
                AND (
                  allowed.repository=problem.suspected_repository
                  OR (match.status='Suggested' AND match.confidence >= 0.68)
                  OR (
                    lower(trim(problem.suspected_repository)) = ANY(
                      ARRAY['','not yet identified','not identified','unknown','tbd','n/a','none']::text[]
                    )
                    AND 1=(
                      SELECT count(*) FROM github_repository_allowlists only_allowed
                       WHERE only_allowed.org_id=problem.org_id
                         AND only_allowed.active=true
                    )
                  )
                )
              )
            )
          ORDER BY
            (match.status='Confirmed') DESC,
            (allowed.repository=problem.suspected_repository) DESC,
            match.confidence DESC NULLS LAST,
            allowed.updated_at DESC
          LIMIT 1
       ) repository ON true
      WHERE problem.org_id=$1 AND problem.stage <> 'Closed'
        AND repository.repository IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM engineering_ticket_specifications specification
           WHERE specification.org_id=problem.org_id AND specification.problem_id=problem.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM implementation_prompts prompt
           WHERE prompt.org_id=problem.org_id AND prompt.problem_id=problem.id
        )
      GROUP BY problem.org_id,problem.id,investigation.hypothesis,investigation.confidence,
               investigation.assumptions,investigation.missing_information,
               investigation.proposed_action,investigation.recommended_tests,
               repository.repository,repository.default_branch,repository.installation_id
               ,repository.execution_profile_config
      HAVING count(membership.feedback_id) >= $2
         AND least(problem.confidence,investigation.confidence) >= $3
         AND (
           ($4::boolean AND count(*) FILTER (WHERE feedback.type IN ('Bug','Incident')) >= count(*) FILTER (WHERE feedback.type='Feature request'))
           OR ($5::boolean AND count(*) FILTER (WHERE feedback.type='Feature request') > count(*) FILTER (WHERE feedback.type IN ('Bug','Incident')))
         )
      ORDER BY problem.confidence DESC,evidence_count DESC,problem.updated_at,problem.id
      LIMIT 25`,
    [orgId, policy.minimumEvidence, policy.minimumConfidence, policy.bugReports, policy.featureRequests],
  );
  return result.rows[0] ?? null;
}

async function createForCandidate(orgId: string, policy: PromptDraftPolicy, row: DraftCandidateRow): Promise<AutomatedPromptDraftResult> {
  const kind = feedbackKind(row);
  const confidence = Math.min(row.confidence, row.investigation_confidence);
  const assessment = assessPromptDraftEligibility(policy, {
    kind,
    evidenceCount: row.evidence_count,
    confidence,
    hasInvestigation: true,
    hasExistingWorkflow: false,
  });
  if (!assessment.eligible || kind === "Other")
    return { created: false, problemId: row.id, promptId: null, reason: assessment.reason };
  if (!row.repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(row.repository)) {
    return {
      created: false,
      problemId: row.id,
      promptId: null,
      reason: "Repository selection requires product-manager review before a prompt can be drafted.",
    };
  }
  const baseSha = await resolveBaseSha(row);
  const redactedEvidence = workspacePersistenceMode(orgId) === "memory"
    ? []
    : (await databasePool().query<{ source: string; observed_at: string; quote: string }>(
      `SELECT feedback.source,feedback.observed_at,feedback.quote
         FROM feedback_cluster_memberships membership
         JOIN feedback_items feedback ON feedback.org_id=membership.org_id AND feedback.id=membership.feedback_id
        WHERE membership.org_id=$1 AND membership.problem_id=$2 AND feedback.redacted=true
        ORDER BY feedback.created_at,feedback.id LIMIT 20`,
      [orgId, row.id],
    )).rows.map((item) => ({ source: item.source, observedAt: item.observed_at, quote: item.quote }));
  const repository = row.repository;
  const result = await createAutomatedPromptDraft(
    orgId,
    row.id,
    {
      specification: buildAutomatedEngineeringDraft({
        kind,
        title: row.title,
        statement: row.statement,
        summary: row.summary,
        proposedAction: row.proposed_action,
        recommendedTests: row.recommended_tests ?? [],
        suspectedFiles: row.suspected_files ?? [],
        repository,
        baseBranch: row.default_branch ?? "main",
        baseSha,
        evidenceCount: row.evidence_count,
        executionProfileConfig: row.execution_profile_config,
      }),
      evidence: promptEvidence(row, redactedEvidence),
      reason: assessment.reason,
      reviewerId: policy.reviewerId,
      notifyInApp: policy.inAppNotifications,
      notifyByEmail: policy.emailNotifications,
    },
    {
      actorId: "agent_prompt_drafter",
      actorName: "Prompt drafting agent",
      traceId: `prompt_draft_${row.id}`,
      idempotencyKey: `prompt_draft_${row.id}`,
    },
  );
  return { created: result.created, problemId: row.id, promptId: result.promptId, reason: assessment.reason };
}

export async function createNextAutomatedPromptDraft(orgId: string): Promise<AutomatedPromptDraftResult> {
  const policy = await readPromptDraftPolicy(orgId);
  // Repository routing is independent from prompt-drafting autonomy. Keep the
  // PM review queue current even when a workspace deliberately uses manual
  // prompt creation.
  if (workspacePersistenceMode(orgId) === "postgres") {
    await refreshPendingProblemRepositoryMatches(orgId);
  }
  if (policy.mode !== "automatic")
    return { created: false, problemId: null, promptId: null, reason: "Automatic prompt drafting is disabled." };
  if (workspacePersistenceMode(orgId) === "memory") {
    const row: DraftCandidateRow = {
      id: primaryProblem.id,
      title: primaryProblem.title,
      statement: primaryProblem.statement,
      summary: primaryProblem.summary,
      severity: primaryProblem.severity,
      confidence: primaryProblem.confidence,
      product_area: primaryProblem.productArea,
      team: primaryProblem.team,
      suspected_repository: primaryProblem.suspectedRepository,
      suspected_files: primaryProblem.suspectedFiles,
      evidence_count: primaryProblem.feedbackIds.length,
      bug_count: primaryProblem.feedbackIds.length,
      feature_count: 0,
      hypothesis: recommendation.hypothesis,
      investigation_confidence: recommendation.confidence,
      assumptions: recommendation.assumptions,
      missing_information: recommendation.missingInformation,
      proposed_action: recommendation.proposedAction,
      recommended_tests: recommendation.tests,
      repository: primaryProblem.suspectedRepository,
      default_branch: "main",
      installation_id: null,
      execution_profile_config: undefined,
    };
    return createForCandidate(orgId, policy, row);
  }
  const candidate = await nextPostgresCandidate(orgId, policy);
  if (!candidate)
    return { created: false, problemId: null, promptId: null, reason: "No unstarted grouped problem has enough investigated evidence." };
  return createForCandidate(orgId, policy, candidate);
}
