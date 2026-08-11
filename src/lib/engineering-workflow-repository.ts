import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import {
  hashImplementationPrompt,
  promptArtifactPath,
  renderImplementationPrompt,
  sanitizeEngineeringTicketDraft,
  ticketReadiness,
  validateEngineeringTicket,
  type AcceptanceCriterion,
  type EngineeringImplementationState,
  type EngineeringTestScenario,
  type EngineeringTicketSpecification,
  type ImplementationPromptSnapshot,
  type PromptEvidence,
  type TestLevel,
} from "./engineering-prompt";
import { primaryProblem, recommendation } from "./seed";
import { workspacePersistenceMode } from "./workspace-persistence";
import { createMemoryPromptReviewNotification } from "./prompt-review-notification-repository";
import {
  validateAgentImplementationReport,
  type AgentImplementationReport,
} from "./agent-run-verification";
import {
  userStoryInputIssue,
} from "./user-story-prompt-test";
import {
  PDD_CLI_VERSION,
  pddRunnerResultSchema,
  renderPddPrompt,
  sha256,
  validateGeneratedTests,
  type PddGeneratedTest,
  type PddVerificationView,
} from "./pdd-verification";
import {
  BILLING_EVENT_NAMES,
  enqueueBillingUsageEvent,
} from "./billing-outbox";
import {
  assertExecutionProfileNarrowing,
  hashExecutionProfileConfig,
  sanitizeExecutionProfileConfig,
  type ExecutionProfileSnapshot,
} from "./execution-profile";
import {
  resolveExecutionProfileForTicket,
} from "./execution-profile-repository";
import {
  getActiveConfirmedProblemRepositoryMatch,
} from "./problem-repository-match-repository";
import {
  createFinalExecutionApproval,
  readFinalExecutionApproval,
  type FinalExecutionApprovalView,
} from "./final-execution-repository";

export interface ImplementationPromptView {
  id: string;
  revision: number;
  status: "Draft" | "Ready" | "Awaiting approval" | "Approved" | "Superseded";
  artifactPath: string;
  content: string;
  contentHash: string;
  repository: string;
  baseBranch: string;
  baseSha: string;
  createdAt: string;
  draftReason?: string | null;
  reviewerId?: string | null;
  reviewerName?: string | null;
  reviewerNotificationRequested?: boolean;
  reviewerEmailNotificationRequested?: boolean;
}

export interface AutomatedPromptDraftInput {
  specification: unknown;
  evidence: PromptEvidence;
  reason: string;
  reviewerId: string | null;
  notifyInApp: boolean;
  notifyByEmail: boolean;
}

export interface EngineeringApprovalView {
  id: string;
  status: "Pending" | "Approved" | "Rejected" | "Superseded" | "Expired";
  expiresAt: string;
  promptHash: string;
  repository: string;
  baseBranch: string;
  baseSha: string;
  allowedCapabilities: string[];
}

export interface EngineeringApprovalRecordView {
  approval: EngineeringApprovalView;
  problemId: string;
  problemTitle: string;
  promptRevision: number | null;
  runId: string | null;
}

export interface AgentRunView {
  id: string;
  approvalId?: string;
  status: "Queued" | "Running" | "Tests passed" | "Draft PR opened" | "Failed" | "Cancelled" | "No changes";
  branchName: string;
  changedFiles: string[];
  testResults: AgentTestResult[];
  criterionResults: CriterionResult[];
  failureCode: string | null;
  failureMessage: string | null;
  pullRequestUrl: string | null;
  queuedAt: string;
  completedAt: string | null;
  implementationSummary?: string;
  testFiles?: string[];
  remainingRisks?: string[];
  manualVerification?: string[];
  logs?: string[];
  runtimeEvidence?: AgentImplementationReport["runtimeEvidence"];
  independentVerification?: AgentImplementationReport["independentVerification"];
}

export interface AgentRunSummaryView {
  id: string;
  approvalId: string | null;
  problemId: string;
  problemTitle: string;
  status: AgentRunView["status"];
  repository: string | null;
  branchName: string;
  pullRequestUrl: string | null;
  queuedAt: string;
  completedAt: string | null;
  independentVerificationStatus: "passed" | "failed" | null;
}

export interface AgentTestResult {
  command: string;
  status: "passed" | "failed" | "skipped";
  output: string;
}

export interface CriterionResult {
  criterionId: string;
  status: "Passed" | "Failed" | "Pending manual" | "Not verified";
  evidence: string;
  scenarioIds: string[];
}

export interface EngineeringWorkflowView {
  problemId: string;
  specification: EngineeringTicketSpecification | null;
  readiness: { ready: boolean; issues: string[] };
  prompt: ImplementationPromptView | null;
  verification: PddVerificationView | null;
  approval: EngineeringApprovalView | null;
  finalApproval: FinalExecutionApprovalView | null;
  run: AgentRunView | null;
  releaseEvidence: ReleaseVerificationEvidence | null;
}

export interface ReleaseVerificationEvidence {
  id: string;
  status: "Passed" | "Failed";
  environment: string;
  evidence: string;
  specificationRevision: number;
  verifiedBy: string;
  verifiedAt: string;
  uiVerification?: {
    jobId: string;
    passedChecks: number;
    totalChecks: number;
    captures: Array<{ key: string; viewport: string }>;
  } | null;
}

export interface UserStoryPromptTestView {
  id: string;
  status: PddVerificationView["status"];
  message: string;
  promptHash: string;
}

export interface PromptAlignmentContext {
  workflow: EngineeringWorkflowView;
  userStory: string;
  promptId: string;
  promptHash: string;
  implementationPrompt: string;
}

export interface PddVerificationExecutionContext {
  orgId: string;
  problemId: string;
  verificationId: string;
  repository: string;
  installationId: string;
  baseBranch: string;
  baseSha: string;
  promptId: string;
  promptHash: string;
  userStory: string;
  pddPrompt: string;
  pddVersion: string;
  budgetUsd: number;
  permittedPaths: string[];
  requiredCommands: string[];
  suspectedFiles: string[];
  executionProfileId: string;
  executionProfileHash: string;
  executionProfileSnapshot: ExecutionProfileSnapshot;
}

export interface AgentRunExecutionContext {
  orgId: string;
  problemId: string;
  runId: string;
  approvalId: string;
  repository: string;
  installationId: string;
  baseBranch: string;
  baseSha: string;
  branchName: string;
  promptId: string;
  promptHash: string;
  promptContent: string;
  promptArtifactPath: string;
  promptSnapshot: ImplementationPromptSnapshot;
  expiresAt: string;
  allowedCapabilities: string[];
  generatedTests?: PddGeneratedTest[];
  executionProfileId: string;
  executionProfileHash: string;
  executionProfileSnapshot: ExecutionProfileSnapshot;
}

export class EngineeringWorkflowError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface ActorContext {
  actorId: string;
  actorName: string;
  traceId: string;
  idempotencyKey: string;
}

interface SpecificationRow {
  id: string;
  revision: number;
  implementation_state: EngineeringImplementationState;
  user_story: string;
  current_behavior: string;
  expected_behavior: string;
  reproduction_steps: string[];
  business_outcome: string;
  regression_scenarios: string[];
  negative_scenarios: string[];
  quality_expectations: string[];
  required_test_levels: TestLevel[];
  release_verification: string;
  non_goals: string[];
  permitted_paths: string[];
  required_commands: string[];
  repository: string;
  base_branch: string;
  base_sha: string;
}

interface ExecutionProfileBindingRow {
  execution_profile_id: string | null;
  execution_profile_hash: string | null;
  execution_profile_snapshot: unknown;
}

function validatedExecutionProfileBinding(
  row: ExecutionProfileBindingRow,
  label: string,
): ExecutionProfileSnapshot {
  if (
    !row.execution_profile_id
    || !row.execution_profile_hash
    || !row.execution_profile_snapshot
    || typeof row.execution_profile_snapshot !== "object"
    || Array.isArray(row.execution_profile_snapshot)
  ) {
    throw new EngineeringWorkflowError(`${label} is missing its immutable execution profile`, 409);
  }
  const value = row.execution_profile_snapshot as Partial<ExecutionProfileSnapshot>;
  let config;
  try {
    config = sanitizeExecutionProfileConfig(value.config);
  } catch {
    throw new EngineeringWorkflowError(`${label} execution profile configuration is invalid`, 409);
  }
  if (
    value.profileId !== row.execution_profile_id
    || value.contentHash !== row.execution_profile_hash
    || hashExecutionProfileConfig(config) !== row.execution_profile_hash
    || !Number.isInteger(value.version)
    || value.version! <= 0
    || !["confirmed", "override", "safe_generic"].includes(value.source ?? "")
    || typeof value.repository !== "string"
    || typeof value.workspaceRoot !== "string"
  ) {
    throw new EngineeringWorkflowError(`${label} execution profile failed its immutable hash check`, 409);
  }
  return {
    profileId: row.execution_profile_id,
    contentHash: row.execution_profile_hash,
    version: value.version!,
    source: value.source,
    repository: value.repository,
    workspaceRoot: value.workspaceRoot,
    config,
  } as ExecutionProfileSnapshot;
}

function sameExecutionProfileBinding(
  left: ExecutionProfileSnapshot,
  right: ExecutionProfileSnapshot,
): boolean {
  return left.profileId === right.profileId
    && left.contentHash === right.contentHash
    && JSON.stringify(left) === JSON.stringify(right);
}

function branchName(problemId: string, runId: string, title: string): string {
  const safeId = problemId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42);
  return `closespan/${safeId}-${runId.slice(0, 8)}-${safeTitle || "ticket"}`;
}

function defaultSpecification(problemId: string): EngineeringTicketSpecification {
  const isPrimary = problemId === primaryProblem.id;
  return {
    implementationState: "Draft specification",
    userStory: isPrimary
      ? "As an analyst, I want large exports to contain all selected rows so that I can complete customer reporting."
      : "",
    currentBehavior: isPrimary ? primaryProblem.statement : "",
    expectedBehavior: isPrimary ? "Completed exports contain every selected row and never expose an empty successful artifact." : "",
    reproductionSteps: isPrimary ? ["Export a dataset above the in-memory row threshold.", "Open the completed CSV artifact."] : [],
    businessOutcome: isPrimary ? "Affected customers can complete scheduled reporting without workarounds." : "",
    acceptanceCriteria: isPrimary
      ? [
          { id: "AC-1", statement: "An export above the row threshold contains every selected data row.", measurable: true },
          { id: "AC-2", statement: "A failed storage commit never reports the export as complete.", measurable: true },
        ]
      : [],
    testScenarios: isPrimary
      ? [
          { id: "TEST-1", title: "Large export completes", given: "A dataset above the in-memory row threshold", when: "The analyst exports CSV", then: "The artifact contains every selected row", testLevel: "integration", criterionIds: ["AC-1"] },
          { id: "TEST-2", title: "Storage commit fails", given: "Object storage rejects the final commit", when: "The export finalizer runs", then: "The export is marked failed and no successful empty artifact is exposed", testLevel: "integration", criterionIds: ["AC-2"] },
        ]
      : [],
    regressionScenarios: isPrimary ? recommendation.tests : [],
    negativeScenarios: isPrimary ? ["A failed object-storage write does not produce a successful completion event."] : [],
    qualityExpectations: ["Do not copy raw customer content, credentials, or production data into tests or logs."],
    requiredTestLevels: isPrimary ? ["integration"] : [],
    releaseVerification: isPrimary ? "After deployment, export a production-safe synthetic dataset above the threshold and verify the row count and completion telemetry." : "",
    nonGoals: ["Automatic merge or deployment.", "Changes outside the explicitly permitted repository paths."],
    permittedPaths: isPrimary ? [...primaryProblem.suspectedFiles, "tests/**"] : [],
    requiredCommands: isPrimary ? ["npm test", "npm run typecheck"] : [],
    repository: isPrimary ? primaryProblem.suspectedRepository : "",
    baseBranch: "main",
    baseSha: isPrimary ? "0".repeat(40) : "",
  };
}

function specFromRows(
  row: SpecificationRow,
  criteria: AcceptanceCriterion[],
  scenarios: EngineeringTestScenario[],
): EngineeringTicketSpecification {
  return {
    id: row.id,
    revision: row.revision,
    implementationState: row.implementation_state,
    userStory: row.user_story,
    currentBehavior: row.current_behavior,
    expectedBehavior: row.expected_behavior,
    reproductionSteps: row.reproduction_steps,
    businessOutcome: row.business_outcome,
    acceptanceCriteria: criteria,
    testScenarios: scenarios,
    regressionScenarios: row.regression_scenarios,
    negativeScenarios: row.negative_scenarios,
    qualityExpectations: row.quality_expectations,
    requiredTestLevels: row.required_test_levels,
    releaseVerification: row.release_verification,
    nonGoals: row.non_goals,
    permittedPaths: row.permitted_paths,
    requiredCommands: row.required_commands,
    repository: row.repository,
    baseBranch: row.base_branch,
    baseSha: row.base_sha,
  };
}

async function readSpecification(
  database: Pool | PoolClient,
  orgId: string,
  problemId: string,
): Promise<EngineeringTicketSpecification | null> {
  const result = await database.query<SpecificationRow>(
    "SELECT * FROM engineering_ticket_specifications WHERE org_id=$1 AND problem_id=$2",
    [orgId, problemId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const [criteria, scenarios] = await Promise.all([
    database.query<{ criterion_id: string; statement: string; measurable: boolean }>(
      `SELECT criterion_id,statement,measurable
         FROM engineering_acceptance_criteria
        WHERE org_id=$1 AND specification_id=$2 ORDER BY ordinal`,
      [orgId, row.id],
    ),
    database.query<{ scenario_id: string; title: string; given_text: string; when_text: string; then_text: string; test_level: TestLevel; criterion_ids: string[] }>(
      `SELECT scenario_id,title,given_text,when_text,then_text,test_level,criterion_ids
         FROM engineering_test_scenarios
        WHERE org_id=$1 AND specification_id=$2 ORDER BY ordinal`,
      [orgId, row.id],
    ),
  ]);
  return specFromRows(
    row,
    criteria.rows.map((item) => ({ id: item.criterion_id, statement: item.statement, measurable: item.measurable })),
    scenarios.rows.map((item) => ({ id: item.scenario_id, title: item.title, given: item.given_text, when: item.when_text, then: item.then_text, testLevel: item.test_level, criterionIds: item.criterion_ids })),
  );
}

async function readPrompt(
  database: Pool | PoolClient,
  orgId: string,
  problemId: string,
): Promise<ImplementationPromptView | null> {
  const result = await database.query<{
    id: string; revision: number; status: ImplementationPromptView["status"];
    artifact_path: string; rendered_content: string; content_hash: string;
    repository: string; base_branch: string; base_sha: string; created_at: Date;
    draft_reason: string | null; reviewer_id: string | null;
    reviewer_name: string | null;
    reviewer_notification_requested: boolean;
    reviewer_email_notification_requested: boolean;
  }>(`SELECT prompt.id,prompt.revision,prompt.status,prompt.artifact_path,
             prompt.rendered_content,prompt.content_hash,prompt.repository,
             prompt.base_branch,prompt.base_sha,prompt.created_at,prompt.draft_reason,
             prompt.reviewer_id,reviewer.display_name AS reviewer_name,
             prompt.reviewer_notification_requested,
             prompt.reviewer_email_notification_requested
        FROM implementation_prompts prompt
        LEFT JOIN workspace_members reviewer
          ON reviewer.org_id=prompt.org_id AND reviewer.id=prompt.reviewer_id
       WHERE prompt.org_id=$1 AND prompt.problem_id=$2
       ORDER BY prompt.revision DESC LIMIT 1`, [orgId, problemId]);
  const row = result.rows[0];
  return row ? {
    id: row.id, revision: row.revision, status: row.status,
    artifactPath: row.artifact_path, content: row.rendered_content,
    contentHash: row.content_hash, repository: row.repository,
    baseBranch: row.base_branch, baseSha: row.base_sha,
    createdAt: row.created_at.toISOString(),
    draftReason: row.draft_reason,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewerNotificationRequested: row.reviewer_notification_requested,
    reviewerEmailNotificationRequested: row.reviewer_email_notification_requested,
  } : null;
}

async function readVerification(
  database: Pool | PoolClient,
  orgId: string,
  problemId: string,
): Promise<PddVerificationView | null> {
  const result = await database.query<{
    id: string; status: PddVerificationView["status"]; user_story: string;
    prompt_hash: string; pdd_version: string; model: string | null;
    budget_usd: string; cost_usd: string | null; summary: string | null;
    generated_tests: PddGeneratedTest[]; failure_message: string | null;
    created_at: Date; completed_at: Date | null;
  }>(`SELECT id,status,user_story,prompt_hash,pdd_version,model,budget_usd,cost_usd,
             summary,generated_tests,failure_message,created_at,completed_at
        FROM pdd_prompt_verifications
       WHERE org_id=$1 AND problem_id=$2
       ORDER BY created_at DESC,id DESC LIMIT 1`, [orgId, problemId]);
  const row = result.rows[0];
  return row ? {
    id: row.id, status: row.status, userStory: row.user_story,
    promptHash: row.prompt_hash, pddVersion: row.pdd_version, model: row.model,
    budgetUsd: Number(row.budget_usd), costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    summary: row.summary, generatedTests: row.generated_tests,
    failureMessage: row.failure_message, createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  } : null;
}

async function readApproval(
  database: Pool | PoolClient,
  orgId: string,
  problemId: string,
): Promise<EngineeringApprovalView | null> {
  const result = await database.query<{
    id: string; status: EngineeringApprovalView["status"]; expires_at: Date;
    prompt_hash: string; repository: string; base_branch: string; base_sha: string;
    allowed_capabilities: string[];
  }>(`SELECT id,status,expires_at,prompt_hash,repository,base_branch,base_sha,allowed_capabilities
        FROM approval_requests
       WHERE org_id=$1 AND problem_id=$2 AND action_type='agent_run'
       ORDER BY created_at DESC,id DESC LIMIT 1`, [orgId, problemId]);
  const row = result.rows[0];
  return row ? {
    id: row.id, status: row.status, expiresAt: row.expires_at.toISOString(),
    promptHash: row.prompt_hash, repository: row.repository,
    baseBranch: row.base_branch, baseSha: row.base_sha,
    allowedCapabilities: row.allowed_capabilities,
  } : null;
}

async function readRun(
  database: Pool | PoolClient,
  orgId: string,
  problemId: string,
  runId?: string,
): Promise<AgentRunView | null> {
  const result = await database.query<{
    id: string; approval_id: string; status: AgentRunView["status"]; branch_name: string;
    changed_files: string[]; test_results: AgentTestResult[]; failure_code: string | null;
    failure_message: string | null; pull_request_url: string | null;
    queued_at: Date; completed_at: Date | null; implementation_report: AgentImplementationReport | null;
  }>(`SELECT id,approval_id,status,branch_name,changed_files,test_results,failure_code,
             failure_message,pull_request_url,queued_at,completed_at,implementation_report
        FROM agent_runs WHERE org_id=$1 AND problem_id=$2 AND ($3::uuid IS NULL OR id=$3)
       ORDER BY queued_at DESC,id DESC LIMIT 1`, [orgId, problemId, runId ?? null]);
  const row = result.rows[0];
  if (!row) return null;
  const criteria = await database.query<{
    criterion_id: string; status: CriterionResult["status"];
    evidence: string; scenario_ids: string[];
  }>(`SELECT criterion_id,status,evidence,scenario_ids
        FROM agent_run_criterion_results WHERE org_id=$1 AND run_id=$2 ORDER BY criterion_id`, [orgId, row.id]);
  return {
    id: row.id, approvalId: row.approval_id, status: row.status, branchName: row.branch_name,
    changedFiles: row.changed_files, testResults: row.test_results,
    criterionResults: criteria.rows.map((item) => ({ criterionId: item.criterion_id, status: item.status, evidence: item.evidence, scenarioIds: item.scenario_ids })),
    failureCode: row.failure_code, failureMessage: row.failure_message,
    pullRequestUrl: row.pull_request_url, queuedAt: row.queued_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    implementationSummary: row.implementation_report?.summary,
    testFiles: row.implementation_report?.testFiles,
    remainingRisks: row.implementation_report?.remainingRisks,
    manualVerification: row.implementation_report?.manualVerification,
    logs: row.implementation_report?.logs,
    runtimeEvidence: row.implementation_report?.runtimeEvidence,
    independentVerification: row.implementation_report?.independentVerification,
  };
}

export async function getAgentRunById(orgId: string, runId: string): Promise<{ problemId: string; run: AgentRunView } | null> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const pair = [...memoryWorkflows.entries()].find(([key, item]) => key.startsWith(`${orgId}:`) && item.run?.id === runId);
    return pair?.[1].run ? { problemId: pair[0].slice(orgId.length + 1), run: structuredClone(pair[1].run) } : null;
  }
  const problem = await databasePool().query<{ problem_id: string }>(
    "SELECT problem_id FROM agent_runs WHERE org_id=$1 AND id=$2",
    [orgId, runId],
  );
  if (!problem.rows[0]) return null;
  const run = await readRun(databasePool(), orgId, problem.rows[0].problem_id, runId);
  return run ? { problemId: problem.rows[0].problem_id, run } : null;
}

export async function listAgentRuns(
  orgId: string,
): Promise<AgentRunSummaryView[]> {
  if (workspacePersistenceMode(orgId) === "memory") {
    return [...memoryWorkflows.entries()]
      .filter(([key, workflow]) => key.startsWith(`${orgId}:`) && workflow.run)
      .map(([key, workflow]) => {
        const run = workflow.run as AgentRunView;
        const problemId = key.slice(orgId.length + 1);
        return {
          id: run.id,
          approvalId: run.approvalId ?? workflow.approval?.id ?? null,
          problemId,
          problemTitle:
            problemId === primaryProblem.id
              ? primaryProblem.title
              : `Product problem ${problemId}`,
          status: run.status,
          repository: workflow.specification.repository || null,
          branchName: run.branchName,
          pullRequestUrl: run.pullRequestUrl,
          queuedAt: run.queuedAt,
          completedAt: run.completedAt,
          independentVerificationStatus:
            run.independentVerification?.status ?? null,
        } satisfies AgentRunSummaryView;
      })
      .sort((left, right) => right.queuedAt.localeCompare(left.queuedAt));
  }

  const result = await databasePool().query<{
    id: string;
    approval_id: string;
    problem_id: string;
    problem_title: string;
    status: AgentRunView["status"];
    repository: string;
    branch_name: string;
    pull_request_url: string | null;
    queued_at: Date;
    completed_at: Date | null;
    implementation_report: AgentImplementationReport | null;
  }>(
    `SELECT run.id,
            run.approval_id,
            run.problem_id,
            problem.title AS problem_title,
            run.status,
            run.repository,
            run.branch_name,
            run.pull_request_url,
            run.queued_at,
            run.completed_at,
            run.implementation_report
       FROM agent_runs run
       JOIN product_problems problem
         ON problem.org_id=run.org_id AND problem.id=run.problem_id
      WHERE run.org_id=$1
      ORDER BY run.queued_at DESC,run.id DESC
      LIMIT 100`,
    [orgId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    approvalId: row.approval_id,
    problemId: row.problem_id,
    problemTitle: row.problem_title,
    status: row.status,
    repository: row.repository,
    branchName: row.branch_name,
    pullRequestUrl: row.pull_request_url,
    queuedAt: row.queued_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    independentVerificationStatus:
      row.implementation_report?.independentVerification?.status ?? null,
  }));
}

export async function getEngineeringApprovalRecord(
  orgId: string,
  approvalId: string,
): Promise<EngineeringApprovalRecordView | null> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const pair = [...memoryWorkflows.entries()].find(
      ([key, workflow]) =>
        key.startsWith(`${orgId}:`) && workflow.approval?.id === approvalId,
    );
    if (!pair?.[1].approval) return null;
    const problemId = pair[0].slice(orgId.length + 1);
    return {
      approval: structuredClone(pair[1].approval),
      problemId,
      problemTitle:
        problemId === primaryProblem.id
          ? primaryProblem.title
          : `Product problem ${problemId}`,
      promptRevision: pair[1].prompt?.revision ?? null,
      runId: pair[1].run?.id ?? null,
    };
  }

  const result = await databasePool().query<{
    id: string;
    status: EngineeringApprovalView["status"];
    expires_at: Date;
    prompt_hash: string;
    repository: string;
    base_branch: string;
    base_sha: string;
    allowed_capabilities: string[];
    problem_id: string;
    problem_title: string;
    prompt_revision: number | null;
    run_id: string | null;
  }>(
    `SELECT approval.id,approval.status,approval.expires_at,approval.prompt_hash,
            approval.repository,approval.base_branch,approval.base_sha,
            approval.allowed_capabilities,approval.problem_id,
            problem.title AS problem_title,prompt.revision AS prompt_revision,
            run.id AS run_id
       FROM approval_requests approval
       JOIN product_problems problem
         ON problem.org_id=approval.org_id AND problem.id=approval.problem_id
       LEFT JOIN implementation_prompts prompt
         ON prompt.org_id=approval.org_id AND prompt.id=approval.prompt_revision_id
       LEFT JOIN agent_runs run
         ON run.org_id=approval.org_id AND run.approval_id=approval.id
      WHERE approval.org_id=$1 AND approval.id=$2
        AND approval.action_type='agent_run'
      LIMIT 1`,
    [orgId, approvalId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    approval: {
      id: row.id,
      status: row.status,
      expiresAt: row.expires_at.toISOString(),
      promptHash: row.prompt_hash,
      repository: row.repository,
      baseBranch: row.base_branch,
      baseSha: row.base_sha,
      allowedCapabilities: row.allowed_capabilities,
    },
    problemId: row.problem_id,
    problemTitle: row.problem_title,
    promptRevision: row.prompt_revision,
    runId: row.run_id,
  };
}

async function postgresWorkflow(orgId: string, problemId: string): Promise<EngineeringWorkflowView> {
  const pool = databasePool();
  const [specification, prompt, verification, approval, finalApproval, run, releaseEvidence] = await Promise.all([
    readSpecification(pool, orgId, problemId),
    readPrompt(pool, orgId, problemId),
    readVerification(pool, orgId, problemId),
    readApproval(pool, orgId, problemId),
    readFinalExecutionApproval(pool, orgId, problemId),
    readRun(pool, orgId, problemId),
    readReleaseEvidence(pool, orgId, problemId),
  ]);
  return { problemId, specification, readiness: ticketReadiness(specification), prompt, verification, approval, finalApproval, run, releaseEvidence };
}

async function readReleaseEvidence(database: Pool | PoolClient, orgId: string, problemId: string): Promise<ReleaseVerificationEvidence | null> {
  const result = await database.query<{
    id: string; status: "Passed" | "Failed"; environment: string; evidence: string;
    specification_revision: number; verified_by: string; verified_at: Date;
    job_id: string | null;
    verification_result: {
      checks?: Array<{ passed?: boolean }>;
      captures?: Array<{ key?: string; viewport?: { name?: string }; screenshotBase64?: string | null }>;
    } | null;
  }>(`SELECT verification.id,verification.status,verification.environment,
              verification.evidence,verification.specification_revision,
              verification.verified_by,verification.verified_at,
              job.id AS job_id,job.verification_result
        FROM engineering_release_verifications verification
        LEFT JOIN LATERAL (
          SELECT id,verification_result
            FROM post_release_verification_jobs
           WHERE org_id=verification.org_id AND problem_id=verification.problem_id
             AND completed_at IS NOT NULL
           ORDER BY completed_at DESC,id DESC LIMIT 1
        ) job ON true
       WHERE verification.org_id=$1 AND verification.problem_id=$2
       ORDER BY verification.verified_at DESC,verification.id DESC LIMIT 1`, [orgId, problemId]);
  const row = result.rows[0];
  return row ? {
    id: row.id, status: row.status, environment: row.environment, evidence: row.evidence,
    specificationRevision: row.specification_revision, verifiedBy: row.verified_by,
    verifiedAt: row.verified_at.toISOString(),
    uiVerification: row.job_id && row.verification_result
      ? {
          jobId: row.job_id,
          passedChecks: (row.verification_result.checks ?? []).filter((check) => check.passed).length,
          totalChecks: (row.verification_result.checks ?? []).length,
          captures: (row.verification_result.captures ?? [])
            .filter((capture) => capture.key && capture.screenshotBase64)
            .map((capture) => ({ key: capture.key!, viewport: capture.viewport?.name ?? "viewport" })),
        }
      : null,
  } : null;
}

interface MemoryWorkflow {
  specification: EngineeringTicketSpecification;
  prompt: ImplementationPromptView | null;
  verification: PddVerificationView | null;
  approval: EngineeringApprovalView | null;
  finalApproval: FinalExecutionApprovalView | null;
  run: AgentRunView | null;
  releaseEvidence: ReleaseVerificationEvidence | null;
}

const workflowMemory = globalThis as typeof globalThis & {
  __closeSpanEngineeringWorkflows?: Map<string, MemoryWorkflow>;
};
const memoryWorkflows =
  workflowMemory.__closeSpanEngineeringWorkflows ??=
    new Map<string, MemoryWorkflow>();

function memoryKey(orgId: string, problemId: string): string {
  return `${orgId}:${problemId}`;
}

function memoryWorkflow(orgId: string, problemId: string): MemoryWorkflow {
  const key = memoryKey(orgId, problemId);
  let current = memoryWorkflows.get(key);
  if (!current) {
    current = { specification: defaultSpecification(problemId), prompt: null, verification: null, approval: null, finalApproval: null, run: null, releaseEvidence: null };
    memoryWorkflows.set(key, current);
  }
  return current;
}

export async function getEngineeringWorkflow(orgId: string, problemId: string): Promise<EngineeringWorkflowView> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const current = memoryWorkflow(orgId, problemId);
    return { problemId, ...structuredClone(current), readiness: ticketReadiness(current.specification) };
  }
  return postgresWorkflow(orgId, problemId);
}

export async function listEngineeringApprovalWorkflows(
  orgId: string,
): Promise<EngineeringWorkflowView[]> {
  if (workspacePersistenceMode(orgId) === "memory") {
    return [...memoryWorkflows.entries()]
      .filter(([key, workflow]) =>
        key.startsWith(`${orgId}:`) && Boolean(workflow.approval || workflow.finalApproval),
      )
      .map(([key, workflow]) => ({
        problemId: key.slice(orgId.length + 1),
        ...structuredClone(workflow),
        readiness: ticketReadiness(workflow.specification),
      }));
  }
  const problems = await databasePool().query<{ problem_id: string }>(
    `SELECT DISTINCT problem_id
       FROM approval_requests
      WHERE org_id=$1 AND action_type IN ('agent_run','final_execution')
      ORDER BY problem_id`,
    [orgId],
  );
  return Promise.all(
    problems.rows.map((row) => postgresWorkflow(orgId, row.problem_id)),
  );
}

async function assertProblem(client: PoolClient, orgId: string, problemId: string): Promise<void> {
  const result = await client.query("SELECT 1 FROM product_problems WHERE org_id=$1 AND id=$2", [orgId, problemId]);
  if (!result.rowCount) throw new EngineeringWorkflowError("Product problem was not found", 404);
}

async function audit(client: PoolClient, orgId: string, actor: ActorContext, action: string, entityType: string, entityId: string): Promise<void> {
  await client.query(
    `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [randomUUID(), orgId, actor.actorId, actor.actorName, action, entityType, entityId, `${actor.traceId}_${randomUUID()}`],
  );
}

export async function saveEngineeringSpecification(
  orgId: string,
  problemId: string,
  input: unknown,
  actor: ActorContext,
): Promise<EngineeringWorkflowView> {
  const draft = sanitizeEngineeringTicketDraft(input);
  if (workspacePersistenceMode(orgId) === "memory") {
    const current = memoryWorkflow(orgId, problemId);
    if (current.approval?.status === "Pending") {
      throw new EngineeringWorkflowError(
        "Reject or expire the pending implementation approval before changing the engineering ticket.",
        409,
      );
    }
    if (current.run && ["Queued", "Running", "Tests passed"].includes(current.run.status)) {
      throw new EngineeringWorkflowError(
        "Wait for or cancel the active implementation run before changing the engineering ticket.",
        409,
      );
    }
    current.specification = { ...draft, id: current.specification.id ?? randomUUID(), revision: (current.specification.revision ?? 0) + 1, implementationState: "Draft specification" };
    if (current.prompt) current.prompt.status = "Superseded";
    if (current.verification && current.approval?.status !== "Approved") current.verification.status = "Superseded";
    return getEngineeringWorkflow(orgId, problemId);
  }
  await transaction(async (client) => {
    await assertProblem(client, orgId, problemId);
    const pendingApproval = await client.query<{ id: string }>(
      `SELECT id FROM approval_requests
        WHERE org_id=$1 AND problem_id=$2 AND action_type='agent_run' AND status='Pending'
        LIMIT 1 FOR UPDATE`,
      [orgId, problemId],
    );
    if (pendingApproval.rowCount) {
      throw new EngineeringWorkflowError(
        "Reject or expire the pending implementation approval before changing the engineering ticket.",
        409,
      );
    }
    const activeRun = await client.query<{ id: string }>(
      `SELECT id FROM agent_runs
        WHERE org_id=$1 AND problem_id=$2 AND status IN ('Queued','Running','Tests passed')
        LIMIT 1 FOR UPDATE`,
      [orgId, problemId],
    );
    if (activeRun.rowCount) {
      throw new EngineeringWorkflowError(
        "Wait for or cancel the active implementation run before changing the engineering ticket.",
        409,
      );
    }
    const existing = await client.query<{ id: string; revision: number }>(
      "SELECT id,revision FROM engineering_ticket_specifications WHERE org_id=$1 AND problem_id=$2 FOR UPDATE",
      [orgId, problemId],
    );
    const id = existing.rows[0]?.id ?? randomUUID();
    const revision = (existing.rows[0]?.revision ?? 0) + 1;
    await client.query(
      `INSERT INTO engineering_ticket_specifications(
         id,org_id,problem_id,revision,implementation_state,user_story,current_behavior,
         expected_behavior,reproduction_steps,business_outcome,regression_scenarios,
         negative_scenarios,quality_expectations,required_test_levels,release_verification,
         non_goals,permitted_paths,required_commands,repository,base_branch,base_sha,
         created_by,updated_by
       ) VALUES($1,$2,$3,$4,'Draft specification',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)
       ON CONFLICT(org_id,problem_id) DO UPDATE SET
         revision=excluded.revision,implementation_state='Draft specification',user_story=excluded.user_story,
         current_behavior=excluded.current_behavior,expected_behavior=excluded.expected_behavior,
         reproduction_steps=excluded.reproduction_steps,business_outcome=excluded.business_outcome,
         regression_scenarios=excluded.regression_scenarios,negative_scenarios=excluded.negative_scenarios,
         quality_expectations=excluded.quality_expectations,required_test_levels=excluded.required_test_levels,
         release_verification=excluded.release_verification,non_goals=excluded.non_goals,
         permitted_paths=excluded.permitted_paths,required_commands=excluded.required_commands,
         repository=excluded.repository,base_branch=excluded.base_branch,base_sha=excluded.base_sha,
         updated_by=excluded.updated_by,updated_at=now()`,
      [id, orgId, problemId, revision, draft.userStory, draft.currentBehavior, draft.expectedBehavior,
        JSON.stringify(draft.reproductionSteps), draft.businessOutcome, JSON.stringify(draft.regressionScenarios),
        JSON.stringify(draft.negativeScenarios), JSON.stringify(draft.qualityExpectations), JSON.stringify(draft.requiredTestLevels),
        draft.releaseVerification, JSON.stringify(draft.nonGoals), JSON.stringify(draft.permittedPaths),
        JSON.stringify(draft.requiredCommands), draft.repository, draft.baseBranch, draft.baseSha, actor.actorId],
    );
    await client.query("DELETE FROM engineering_acceptance_criteria WHERE org_id=$1 AND specification_id=$2", [orgId, id]);
    await client.query("DELETE FROM engineering_test_scenarios WHERE org_id=$1 AND specification_id=$2", [orgId, id]);
    for (const [ordinal, criterion] of draft.acceptanceCriteria.entries()) {
      await client.query(
        `INSERT INTO engineering_acceptance_criteria(org_id,specification_id,criterion_id,ordinal,statement,measurable)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [orgId, id, criterion.id, ordinal, criterion.statement, criterion.measurable],
      );
    }
    for (const [ordinal, scenario] of draft.testScenarios.entries()) {
      await client.query(
        `INSERT INTO engineering_test_scenarios(org_id,specification_id,scenario_id,ordinal,title,given_text,when_text,then_text,test_level,criterion_ids)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [orgId, id, scenario.id, ordinal, scenario.title, scenario.given, scenario.when, scenario.then, scenario.testLevel, JSON.stringify(scenario.criterionIds)],
      );
    }
    await client.query("UPDATE implementation_prompts SET status='Superseded' WHERE org_id=$1 AND problem_id=$2 AND status <> 'Superseded'", [orgId, problemId]);
    await client.query(
      `UPDATE pdd_prompt_verifications verification
          SET status='Superseded',
              completed_at=CASE
                WHEN verification.status IN ('Queued','Generating tests')
                  THEN coalesce(verification.completed_at,now())
                ELSE verification.completed_at
              END
        WHERE verification.org_id=$1 AND verification.problem_id=$2
          AND verification.status NOT IN ('Failed','Superseded')
          AND NOT EXISTS (
            SELECT 1 FROM approval_requests approval
             WHERE approval.org_id=verification.org_id
               AND approval.pdd_verification_id=verification.id
               AND approval.status IN ('Pending','Approved')
          )
          AND NOT EXISTS (
            SELECT 1 FROM agent_runs run
             WHERE run.org_id=verification.org_id
               AND run.pdd_verification_id=verification.id
               AND run.status IN ('Queued','Running','Tests passed')
          )`,
      [orgId, problemId],
    );
    await audit(client, orgId, actor, `Saved engineering ticket specification revision ${revision}; unbound prompt and PDD drafts were superseded`, "EngineeringTicket", problemId);
  });
  return postgresWorkflow(orgId, problemId);
}

export async function createAutomatedPromptDraft(
  orgId: string,
  problemId: string,
  input: AutomatedPromptDraftInput,
  actor: ActorContext,
): Promise<{ created: boolean; promptId: string | null }> {
  const draft = sanitizeEngineeringTicketDraft(input.specification);
  const specificationId = randomUUID();
  const promptId = randomUUID();
  const artifactPath = promptArtifactPath(problemId, input.evidence.title);
  const ticket: EngineeringTicketSpecification = {
    ...draft,
    id: specificationId,
    revision: 1,
    implementationState: "Draft specification",
  };
  const snapshot: ImplementationPromptSnapshot = {
    schemaVersion: 1,
    ticket,
    evidence: input.evidence,
  };
  const content = renderImplementationPrompt(snapshot, {
    promptRevision: 1,
    artifactPath,
  });
  const contentHash = hashImplementationPrompt(content);

  if (workspacePersistenceMode(orgId) === "memory") {
    const current = memoryWorkflow(orgId, problemId);
    if (current.prompt || current.specification.revision) return { created: false, promptId: null };
    current.specification = ticket;
    current.prompt = {
      id: promptId,
      revision: 1,
      status: "Draft",
      artifactPath,
      content,
      contentHash,
      repository: ticket.repository,
      baseBranch: ticket.baseBranch,
      baseSha: ticket.baseSha,
      createdAt: new Date().toISOString(),
      draftReason: input.reason,
      reviewerId: input.reviewerId,
      reviewerNotificationRequested: input.notifyInApp && Boolean(input.reviewerId),
      reviewerEmailNotificationRequested: input.notifyByEmail && Boolean(input.reviewerId),
    };
    if (input.notifyInApp && input.reviewerId) {
      createMemoryPromptReviewNotification({
        orgId,
        reviewerId: input.reviewerId,
        notification: {
          id: randomUUID(),
          problemId,
          promptId,
          title: input.evidence.title,
          artifactPath,
          status: "Unread",
          createdAt: new Date().toISOString(),
          readAt: null,
        },
      });
    }
    return { created: true, promptId };
  }

  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`closespan-prompt-draft:${orgId}:${problemId}`]);
    await assertProblem(client, orgId, problemId);
    const existing = await client.query(
      `SELECT 1 FROM engineering_ticket_specifications WHERE org_id=$1 AND problem_id=$2
       UNION ALL
       SELECT 1 FROM implementation_prompts WHERE org_id=$1 AND problem_id=$2
       LIMIT 1`,
      [orgId, problemId],
    );
    if (existing.rowCount) return { created: false, promptId: null };
    await client.query(
      `INSERT INTO engineering_ticket_specifications(
         id,org_id,problem_id,revision,implementation_state,user_story,current_behavior,
         expected_behavior,reproduction_steps,business_outcome,regression_scenarios,
         negative_scenarios,quality_expectations,required_test_levels,release_verification,
         non_goals,permitted_paths,required_commands,repository,base_branch,base_sha,
         created_by,updated_by
       ) VALUES($1,$2,$3,1,'Draft specification',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)`,
      [
        specificationId, orgId, problemId, draft.userStory, draft.currentBehavior,
        draft.expectedBehavior, JSON.stringify(draft.reproductionSteps), draft.businessOutcome,
        JSON.stringify(draft.regressionScenarios), JSON.stringify(draft.negativeScenarios),
        JSON.stringify(draft.qualityExpectations), JSON.stringify(draft.requiredTestLevels),
        draft.releaseVerification, JSON.stringify(draft.nonGoals), JSON.stringify(draft.permittedPaths),
        JSON.stringify(draft.requiredCommands), draft.repository, draft.baseBranch, draft.baseSha,
        actor.actorId,
      ],
    );
    for (const [ordinal, criterion] of draft.acceptanceCriteria.entries()) {
      await client.query(
        `INSERT INTO engineering_acceptance_criteria(org_id,specification_id,criterion_id,ordinal,statement,measurable)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [orgId, specificationId, criterion.id, ordinal, criterion.statement, criterion.measurable],
      );
    }
    for (const [ordinal, scenario] of draft.testScenarios.entries()) {
      await client.query(
        `INSERT INTO engineering_test_scenarios(org_id,specification_id,scenario_id,ordinal,title,given_text,when_text,then_text,test_level,criterion_ids)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [orgId, specificationId, scenario.id, ordinal, scenario.title, scenario.given, scenario.when, scenario.then, scenario.testLevel, JSON.stringify(scenario.criterionIds)],
      );
    }
    await client.query(
      `INSERT INTO implementation_prompts(
         id,org_id,problem_id,specification_id,specification_revision,revision,status,
         repository,base_branch,base_sha,artifact_path,structured_snapshot,rendered_content,
         content_hash,created_by,draft_reason,reviewer_id,reviewer_notification_requested,
         reviewer_email_notification_requested
       ) VALUES($1,$2,$3,$4,1,1,'Draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        promptId, orgId, problemId, specificationId, draft.repository, draft.baseBranch,
        draft.baseSha, artifactPath, JSON.stringify(snapshot), content, contentHash,
        actor.actorId, input.reason, input.reviewerId,
        input.notifyInApp && Boolean(input.reviewerId),
        input.notifyByEmail && Boolean(input.reviewerId),
      ],
    );
    if (input.notifyInApp && input.reviewerId) {
      await client.query(
        `INSERT INTO prompt_review_notifications(id,org_id,prompt_id,problem_id,reviewer_id,status)
         VALUES($1,$2,$3,$4,$5,'Unread') ON CONFLICT DO NOTHING`,
        [randomUUID(), orgId, promptId, problemId, input.reviewerId],
      );
    }
    if (input.notifyByEmail && input.reviewerId) {
      await client.query(
        `INSERT INTO prompt_review_email_outbox(
           id,org_id,prompt_id,problem_id,reviewer_id,to_email,status
         ) SELECT $1,$2,$3,$4,member.id,member.email,'Pending'
             FROM workspace_members member
            WHERE member.org_id=$2 AND member.id=$5
         ON CONFLICT DO NOTHING`,
        [randomUUID(), orgId, promptId, problemId, input.reviewerId],
      );
    }
    await audit(
      client,
      orgId,
      actor,
      `Created automatic implementation prompt draft at ${artifactPath}; human review is required before PDD or Tenki execution`,
      "ImplementationPrompt",
      problemId,
    );
    await client.query("UPDATE workspaces SET version=version+1,updated_at=now() WHERE org_id=$1", [orgId]);
    return { created: true, promptId };
  });
}

async function promptEvidence(client: PoolClient, orgId: string, problemId: string): Promise<PromptEvidence> {
  const result = await client.query<{
    id: string; title: string; statement: string; summary: string; severity: string;
    product_area: string; team: string; suspected_files: string[];
    hypothesis: string | null; assumptions: string[] | null; missing_information: string[] | null;
  }>(`SELECT p.id,p.title,p.statement,p.summary,p.severity,p.product_area,p.team,p.suspected_files,
             i.hypothesis,i.assumptions,i.missing_information
        FROM product_problems p
        LEFT JOIN LATERAL (
          SELECT hypothesis,assumptions,missing_information FROM investigations
           WHERE org_id=p.org_id AND problem_id=p.id ORDER BY updated_at DESC LIMIT 1
        ) i ON true WHERE p.org_id=$1 AND p.id=$2`, [orgId, problemId]);
  const row = result.rows[0];
  if (!row) throw new EngineeringWorkflowError("Product problem was not found", 404);
  const evidence = await client.query<{ source: string; observed_at: string; quote: string }>(
    `SELECT f.source,f.observed_at,f.quote
       FROM feedback_cluster_memberships membership
       JOIN feedback_items f ON f.org_id=membership.org_id AND f.id=membership.feedback_id
      WHERE membership.org_id=$1 AND membership.problem_id=$2 AND f.redacted=true
      ORDER BY f.created_at,f.id LIMIT 20`, [orgId, problemId],
  );
  return {
    problemId: row.id, title: row.title, statement: row.statement, summary: row.summary,
    severity: row.severity, productArea: row.product_area, team: row.team,
    hypothesis: row.hypothesis ?? undefined, assumptions: row.assumptions ?? [],
    missingInformation: row.missing_information ?? [], suspectedFiles: row.suspected_files ?? [],
    redactedEvidence: evidence.rows.map((item) => ({ source: item.source, observedAt: item.observed_at, quote: item.quote })),
  };
}

export async function generateImplementationPrompt(
  orgId: string,
  problemId: string,
  actor: ActorContext,
): Promise<EngineeringWorkflowView> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const current = memoryWorkflow(orgId, problemId);
    const ticket = validateEngineeringTicket(current.specification);
    const revision = (current.prompt?.revision ?? 0) + 1;
    const artifactPath = promptArtifactPath(problemId, primaryProblem.title);
    const snapshot: ImplementationPromptSnapshot = {
      schemaVersion: 1,
      ticket,
      evidence: {
        problemId, title: primaryProblem.title, statement: primaryProblem.statement,
        summary: primaryProblem.summary, severity: primaryProblem.severity,
        productArea: primaryProblem.productArea, team: primaryProblem.team,
        hypothesis: recommendation.hypothesis, assumptions: recommendation.assumptions,
        missingInformation: recommendation.missingInformation,
        suspectedFiles: primaryProblem.suspectedFiles, redactedEvidence: [],
      },
    };
    const content = renderImplementationPrompt(snapshot, { promptRevision: revision, artifactPath });
    current.prompt = { id: randomUUID(), revision, status: "Ready", artifactPath, content, contentHash: hashImplementationPrompt(content), repository: ticket.repository, baseBranch: ticket.baseBranch, baseSha: ticket.baseSha, createdAt: new Date().toISOString() };
    current.specification.implementationState = "Prompt ready";
    return getEngineeringWorkflow(orgId, problemId);
  }
  await transaction(async (client) => {
    const specification = await readSpecification(client, orgId, problemId);
    if (!specification) throw new EngineeringWorkflowError("Create the engineering ticket specification first", 409);
    const ticket = validateEngineeringTicket(specification);
    const evidence = await promptEvidence(client, orgId, problemId);
    const previous = await client.query<{ revision: number }>(
      "SELECT revision FROM implementation_prompts WHERE org_id=$1 AND problem_id=$2 ORDER BY revision DESC LIMIT 1 FOR UPDATE",
      [orgId, problemId],
    );
    const revision = (previous.rows[0]?.revision ?? 0) + 1;
    const artifactPath = promptArtifactPath(problemId, evidence.title);
    const snapshot: ImplementationPromptSnapshot = { schemaVersion: 1, ticket, evidence };
    const content = renderImplementationPrompt(snapshot, { promptRevision: revision, artifactPath });
    const hash = hashImplementationPrompt(content);
    await client.query("UPDATE implementation_prompts SET status='Superseded' WHERE org_id=$1 AND problem_id=$2 AND status <> 'Superseded'", [orgId, problemId]);
    await client.query(
      `INSERT INTO implementation_prompts(
        id,org_id,problem_id,specification_id,specification_revision,revision,status,
        repository,base_branch,base_sha,artifact_path,structured_snapshot,rendered_content,content_hash,created_by
      ) VALUES($1,$2,$3,$4,$5,$6,'Ready',$7,$8,$9,$10,$11,$12,$13,$14)`,
      [randomUUID(), orgId, problemId, specification.id, specification.revision, revision,
        ticket.repository, ticket.baseBranch, ticket.baseSha.toLowerCase(), artifactPath,
        JSON.stringify(snapshot), content, hash, actor.actorId],
    );
    await client.query("UPDATE engineering_ticket_specifications SET implementation_state='Prompt ready',updated_at=now() WHERE org_id=$1 AND problem_id=$2", [orgId, problemId]);
    await audit(client, orgId, actor, `Generated immutable implementation prompt revision ${revision} with SHA-256 ${hash}`, "ImplementationPrompt", problemId);
  });
  return postgresWorkflow(orgId, problemId);
}

export async function getPromptAlignmentContext(
  orgId: string,
  problemId: string,
  userStory: unknown,
  actor: ActorContext,
): Promise<PromptAlignmentContext> {
  const issue = userStoryInputIssue(userStory);
  if (issue) throw new EngineeringWorkflowError(issue, 400);
  const story = (userStory as string).trim();
  let workflow = await getEngineeringWorkflow(orgId, problemId);
  if (!workflow.prompt || workflow.prompt.status === "Superseded") {
    if (!workflow.specification || !workflow.readiness.ready) {
      throw new EngineeringWorkflowError(
        "A reviewable implementation prompt is required before testing the suggested prompt.",
        409,
      );
    }
    workflow = await generateImplementationPrompt(orgId, problemId, actor);
  }
  if (!workflow.prompt) {
    throw new EngineeringWorkflowError(
      "A reviewable implementation prompt is required before testing the suggested prompt.",
      409,
    );
  }
  if (workflow.prompt.status === "Approved") {
    throw new EngineeringWorkflowError(
      "This implementation prompt has already been approved for execution.",
      409,
    );
  }
  return {
    workflow,
    userStory: story,
    promptId: workflow.prompt.id,
    promptHash: workflow.prompt.contentHash,
    implementationPrompt: workflow.prompt.content,
  };
}

export async function applyPddPromptRevision(
  orgId: string,
  problemId: string,
  input: { currentPromptHash: string; revisedPrompt: string },
  actor: ActorContext,
): Promise<EngineeringWorkflowView> {
  const revisedPrompt = input.revisedPrompt.trim();
  if (!revisedPrompt || revisedPrompt.length > 64_000) {
    throw new EngineeringWorkflowError("The PDD prompt revision is invalid", 400);
  }
  const revisedHash = hashImplementationPrompt(revisedPrompt);
  if (workspacePersistenceMode(orgId) === "memory") {
    const current = memoryWorkflow(orgId, problemId);
    if (!current.prompt || current.prompt.contentHash !== input.currentPromptHash) {
      throw new EngineeringWorkflowError("The suggested prompt changed; test it again", 409);
    }
    current.prompt = {
      ...current.prompt,
      id: randomUUID(),
      revision: current.prompt.revision + 1,
      status: "Ready",
      content: revisedPrompt,
      contentHash: revisedHash,
      createdAt: new Date().toISOString(),
    };
    return getEngineeringWorkflow(orgId, problemId);
  }
  await transaction(async (client) => {
    const result = await client.query<{
      id: string; specification_id: string; specification_revision: number; revision: number;
      status: string; repository: string; base_branch: string; base_sha: string;
      artifact_path: string; structured_snapshot: unknown; content_hash: string;
    }>(
      `SELECT id,specification_id,specification_revision,revision,status,repository,
              base_branch,base_sha,artifact_path,structured_snapshot,content_hash
         FROM implementation_prompts
        WHERE org_id=$1 AND problem_id=$2 AND status <> 'Superseded'
        ORDER BY revision DESC LIMIT 1 FOR UPDATE`,
      [orgId, problemId],
    );
    const current = result.rows[0];
    if (!current || current.content_hash !== input.currentPromptHash) {
      throw new EngineeringWorkflowError("The suggested prompt changed; test it again", 409);
    }
    if (current.status === "Approved") {
      throw new EngineeringWorkflowError("An approved prompt cannot be revised", 409);
    }
    const revision = current.revision + 1;
    await client.query(
      "UPDATE implementation_prompts SET status='Superseded' WHERE org_id=$1 AND problem_id=$2 AND status <> 'Superseded'",
      [orgId, problemId],
    );
    await client.query(
      `INSERT INTO implementation_prompts(
        id,org_id,problem_id,specification_id,specification_revision,revision,status,
        repository,base_branch,base_sha,artifact_path,structured_snapshot,rendered_content,content_hash,created_by
      ) VALUES($1,$2,$3,$4,$5,$6,'Ready',$7,$8,$9,$10,$11,$12,$13,$14)`,
      [randomUUID(), orgId, problemId, current.specification_id,
        current.specification_revision, revision, current.repository,
        current.base_branch, current.base_sha, current.artifact_path,
        JSON.stringify(current.structured_snapshot), revisedPrompt, revisedHash, actor.actorId],
    );
    await audit(client, orgId, actor, `Applied PDD-guided implementation prompt revision ${revision} with SHA-256 ${revisedHash}`, "ImplementationPrompt", problemId);
  });
  return getEngineeringWorkflow(orgId, problemId);
}

export async function generatePddAcceptanceContract(
  orgId: string,
  problemId: string,
  userStory: unknown,
  actor: ActorContext,
): Promise<{
  workflow: EngineeringWorkflowView;
  storyTest: UserStoryPromptTestView;
}> {
  const issue = userStoryInputIssue(userStory);
  if (issue) throw new EngineeringWorkflowError(issue, 400);
  const story = (userStory as string).trim();
  let workflow = await getEngineeringWorkflow(orgId, problemId);
  if (!workflow.specification) {
    throw new EngineeringWorkflowError(
      "Engineering ticket specification is missing. Review the investigation and complete the ticket context before generating an acceptance test.",
      409,
    );
  }
  const confirmedRepositoryMatch = workspacePersistenceMode(orgId) === "postgres"
    ? await getActiveConfirmedProblemRepositoryMatch(orgId, problemId)
    : null;
  if (workspacePersistenceMode(orgId) === "postgres") {
    if (!confirmedRepositoryMatch) {
      throw new EngineeringWorkflowError(
        "Confirm this ticket's repository and an active execution profile before PDD testing.",
        409,
      );
    }
    if (workflow.specification.repository !== confirmedRepositoryMatch.repository) {
      throw new EngineeringWorkflowError(
        "The confirmed repository does not match the engineering ticket. Review the ticket repository context before PDD testing.",
        409,
      );
    }
  }
  if (!workflow.prompt || workflow.prompt.status === "Superseded") {
    if (!workflow.readiness.ready) {
      throw new EngineeringWorkflowError(
        `Engineering ticket specification is incomplete: ${workflow.readiness.issues.slice(0, 3).join("; ")}`,
        409,
      );
    }
    workflow = await generateImplementationPrompt(orgId, problemId, actor);
  }
  if (workflow.prompt?.status === "Draft") {
    if (!workflow.readiness.ready) {
      throw new EngineeringWorkflowError(
        `The automatic prompt draft needs product-manager review: ${workflow.readiness.issues.slice(0, 3).join("; ")}`,
        409,
      );
    }
    workflow = await generateImplementationPrompt(orgId, problemId, actor);
  }
  if (!workflow.prompt) {
    throw new EngineeringWorkflowError(
      "Ticket context is incomplete. CloseSpan could not build a testable prompt yet.",
      409,
    );
  }
  const prompt = workflow.prompt;
  if (
    workflow.verification?.promptHash === prompt.contentHash &&
    workflow.verification.userStory === story &&
    !["Failed", "Superseded"].includes(workflow.verification.status)
  ) {
    return {
      workflow,
      storyTest: {
        id: workflow.verification.id,
        status: workflow.verification.status,
        message: verificationMessage(workflow.verification.status),
        promptHash: prompt.contentHash,
      },
    };
  }
  if (prompt.status !== "Ready") {
    throw new EngineeringWorkflowError("This prompt already has a pending or consumed approval. Finish or reject it before testing another story.", 409);
  }
  const verificationId = randomUUID();
  const budgetUsd = pddBudgetUsd();
  if (workspacePersistenceMode(orgId) === "memory") {
    const current = memoryWorkflow(orgId, problemId);
    if (current.verification && !["Failed", "Superseded"].includes(current.verification.status))
      current.verification.status = "Superseded";
    const demoTestContent = `// Seeded demo acceptance contract\n// ${story}\n`;
    current.verification = {
      id: verificationId, status: "Ready for approval", userStory: story,
      promptHash: prompt.contentHash, pddVersion: PDD_CLI_VERSION,
      model: "demo-fixture", budgetUsd, costUsd: 0,
      summary: "Seeded demo acceptance contract ready.",
      generatedTests: [{ path: "tests/pdd.acceptance.test.ts", content: demoTestContent, contentHash: sha256(demoTestContent), command: "npm test" }],
      failureMessage: null, createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    };
    workflow = await requestImplementationApproval(orgId, prompt.id, actor);
  } else {
    const ticketBindingResult = await databasePool().query<ExecutionProfileBindingRow>(
      `SELECT execution_profile_id,execution_profile_hash,execution_profile_snapshot
         FROM engineering_ticket_specifications
        WHERE org_id=$1 AND problem_id=$2`,
      [orgId, problemId],
    );
    const ticketBinding = ticketBindingResult.rows[0];
    const ticketOverride = ticketBinding?.execution_profile_id
      ? validatedExecutionProfileBinding(ticketBinding, "Engineering ticket")
      : null;
    if (
      ticketOverride &&
      (
        ticketOverride.repository !== confirmedRepositoryMatch?.repository ||
        ticketOverride.workspaceRoot !== confirmedRepositoryMatch.workspaceRoot
      )
    ) {
      throw new EngineeringWorkflowError(
        "The ticket's explicit execution profile override does not match the confirmed repository root.",
        409,
      );
    }
    const resolvedProfile = await resolveExecutionProfileForTicket({
      orgId,
      repository: prompt.repository,
      workspaceRoot: ticketOverride?.workspaceRoot
        ?? confirmedRepositoryMatch?.workspaceRoot
        ?? ".",
      ticketOverrideProfileId: ticketOverride?.profileId,
    });
    if (
      !ticketOverride &&
      (
        resolvedProfile.snapshot.profileId !== confirmedRepositoryMatch?.profileId ||
        resolvedProfile.snapshot.contentHash !== confirmedRepositoryMatch.profileHash
      )
    ) {
      throw new EngineeringWorkflowError(
        "The active execution profile changed after repository review. Confirm the current profile before PDD testing.",
        409,
      );
    }
    assertExecutionProfileNarrowing(resolvedProfile.snapshot, {
      permittedPaths: workflow.specification!.permittedPaths,
      requiredCommands: workflow.specification!.requiredCommands,
    });
    await transaction(async (client) => {
      await client.query(
        `UPDATE pdd_prompt_verifications
            SET status='Superseded',
                completed_at=CASE
                  WHEN status IN ('Queued','Generating tests') THEN coalesce(completed_at,now())
                  ELSE completed_at
                END
          WHERE org_id=$1 AND problem_id=$2 AND prompt_revision_id=$3
            AND status IN ('Queued','Generating tests','Ready for approval')
            AND NOT EXISTS (
              SELECT 1 FROM approval_requests approval
               WHERE approval.org_id=pdd_prompt_verifications.org_id
                 AND approval.pdd_verification_id=pdd_prompt_verifications.id
                 AND approval.status IN ('Pending','Approved')
            )`,
        [orgId, problemId, prompt.id],
      );
      await client.query(
        `INSERT INTO pdd_prompt_verifications(
          id,org_id,problem_id,prompt_revision_id,prompt_hash,user_story,story_hash,status,
          pdd_version,budget_usd,created_by,execution_profile_id,execution_profile_hash,
          execution_profile_snapshot
        ) VALUES($1,$2,$3,$4,$5,$6,$7,'Queued',$8,$9,$10,$11,$12,$13)`,
        [verificationId, orgId, problemId, prompt.id, prompt.contentHash, story,
          sha256(story.replace(/\s+/g, " ").trim()), PDD_CLI_VERSION, budgetUsd, actor.actorId,
          resolvedProfile.snapshot.profileId, resolvedProfile.snapshot.contentHash,
          JSON.stringify(resolvedProfile.snapshot)],
      );
      await audit(client, orgId, actor, `Queued PDD ${PDD_CLI_VERSION} acceptance-test generation for prompt ${prompt.contentHash}`, "PddPromptVerification", verificationId);
    });
    workflow = await postgresWorkflow(orgId, problemId);
  }
  return {
    workflow,
    storyTest: {
      id: verificationId,
      status: workflow.verification?.status ?? "Queued",
      message: verificationMessage(workflow.verification?.status ?? "Queued"),
      promptHash: prompt.contentHash,
    },
  };
}

function pddBudgetUsd(): number {
  const value = Number(process.env.PDD_MAX_BUDGET_USD ?? "0.25");
  if (!Number.isFinite(value) || value <= 0 || value > 100)
    throw new Error("PDD_MAX_BUDGET_USD must be between 0 and 100");
  return Math.round(value * 10_000) / 10_000;
}

function verificationMessage(status: PddVerificationView["status"]): string {
  if (status === "Queued") return "The story is queued for executable acceptance-test generation.";
  if (status === "Generating tests") return "PDD is translating the story into repository-native acceptance tests.";
  if (status === "Ready for approval") return "The executable acceptance contract is ready for PM review.";
  if (status === "Failed") return "PDD could not produce a safe executable acceptance contract.";
  return "This verification was replaced by a newer ticket or story.";
}

export async function getPddVerificationExecutionContext(
  orgId: string,
  verificationId: string,
): Promise<PddVerificationExecutionContext> {
  if (workspacePersistenceMode(orgId) === "memory")
    throw new EngineeringWorkflowError("Live PDD execution is unavailable in the seeded memory workspace", 409);
  const result = await databasePool().query<{
    problem_id: string; repository: string; installation_id: string; base_branch: string; base_sha: string;
    prompt_revision_id: string; prompt_hash: string; user_story: string;
    pdd_version: string; budget_usd: string; status: PddVerificationView["status"];
    structured_snapshot: ImplementationPromptSnapshot;
    execution_profile_id: string | null; execution_profile_hash: string | null;
    execution_profile_snapshot: unknown;
    }>(`SELECT verification.problem_id,prompt.repository,allowlist.installation_id::text,
             prompt.base_branch,prompt.base_sha,verification.prompt_revision_id,verification.prompt_hash,
             verification.user_story,verification.pdd_version,verification.budget_usd,
             verification.status,prompt.structured_snapshot,verification.execution_profile_id,
             verification.execution_profile_hash,verification.execution_profile_snapshot
        FROM pdd_prompt_verifications verification
        JOIN implementation_prompts prompt ON prompt.org_id=verification.org_id
          AND prompt.id=verification.prompt_revision_id
        JOIN github_repository_allowlists allowlist ON allowlist.org_id=verification.org_id
          AND allowlist.repository=prompt.repository AND allowlist.active=true
       WHERE verification.org_id=$1 AND verification.id=$2`, [orgId, verificationId]);
  const row = result.rows[0];
  if (!row) throw new EngineeringWorkflowError("PDD verification or repository authorization was not found", 404);
  if (!["Queued", "Generating tests"].includes(row.status))
    throw new EngineeringWorkflowError("PDD verification is no longer executable", 409);
  const executionProfileSnapshot = validatedExecutionProfileBinding(row, "PDD verification");
  assertExecutionProfileNarrowing(executionProfileSnapshot, {
    permittedPaths: row.structured_snapshot.ticket.permittedPaths,
    requiredCommands: row.structured_snapshot.ticket.requiredCommands,
  });
  return {
    orgId, problemId: row.problem_id, verificationId,
    repository: row.repository, installationId: row.installation_id,
    baseBranch: row.base_branch, baseSha: row.base_sha, promptId: row.prompt_revision_id,
    promptHash: row.prompt_hash, userStory: row.user_story,
    pddPrompt: renderPddPrompt(row.user_story, row.structured_snapshot),
    pddVersion: row.pdd_version, budgetUsd: Number(row.budget_usd),
    permittedPaths: row.structured_snapshot.ticket.permittedPaths,
    requiredCommands: row.structured_snapshot.ticket.requiredCommands,
    suspectedFiles: row.structured_snapshot.evidence.suspectedFiles,
    executionProfileId: executionProfileSnapshot.profileId,
    executionProfileHash: executionProfileSnapshot.contentHash,
    executionProfileSnapshot,
  };
}

export async function markPddVerificationGenerating(
  orgId: string,
  verificationId: string,
): Promise<void> {
  if (workspacePersistenceMode(orgId) === "memory") return;
  const result = await databasePool().query(
    `UPDATE pdd_prompt_verifications SET status='Generating tests',started_at=coalesce(started_at,now())
      WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Generating tests')`,
    [orgId, verificationId],
  );
  if (!result.rowCount) throw new EngineeringWorkflowError("PDD verification cannot be started", 409);
}

export async function failPddVerification(
  orgId: string,
  verificationId: string,
  message: string,
): Promise<void> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const entry = [...memoryWorkflows.values()].find((item) => item.verification?.id === verificationId);
    if (entry?.verification) {
      entry.verification.status = "Failed";
      entry.verification.failureMessage = message.slice(0, 5_000);
      entry.verification.completedAt = new Date().toISOString();
    }
    return;
  }
  await databasePool().query(
    `UPDATE pdd_prompt_verifications SET status='Failed',failure_message=$3,completed_at=now()
      WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Generating tests')`,
    [orgId, verificationId, message.slice(0, 5_000)],
  );
}

export async function completePddVerification(
  orgId: string,
  verificationId: string,
  payload: unknown,
  actor: ActorContext,
): Promise<EngineeringWorkflowView> {
  if (workspacePersistenceMode(orgId) === "memory")
    throw new EngineeringWorkflowError("Live PDD completion is unavailable in the seeded memory workspace", 409);
  const parsed = pddRunnerResultSchema.parse(payload);
  if (parsed.verificationId !== verificationId)
    throw new EngineeringWorkflowError("PDD callback does not match the requested verification", 409);
  let problemId = "";
  let shouldRequestApproval = false;
  let promptId = "";
  await transaction(async (client) => {
    const current = await client.query<{
      problem_id: string; prompt_revision_id: string; prompt_hash: string;
      status: PddVerificationView["status"]; structured_snapshot: ImplementationPromptSnapshot;
      pdd_version: string; budget_usd: string;
      execution_profile_id: string | null; execution_profile_hash: string | null;
      execution_profile_snapshot: unknown;
    }>(`SELECT verification.problem_id,verification.prompt_revision_id,verification.prompt_hash,
               verification.status,verification.pdd_version,verification.budget_usd,prompt.structured_snapshot,
               verification.execution_profile_id,verification.execution_profile_hash,
               verification.execution_profile_snapshot
          FROM pdd_prompt_verifications verification
          JOIN implementation_prompts prompt ON prompt.org_id=verification.org_id
            AND prompt.id=verification.prompt_revision_id
         WHERE verification.org_id=$1 AND verification.id=$2 FOR UPDATE`, [orgId, verificationId]);
    const row = current.rows[0];
    if (!row) throw new EngineeringWorkflowError("PDD verification was not found", 404);
    if (!["Queued", "Generating tests"].includes(row.status))
      throw new EngineeringWorkflowError("PDD verification is already complete or superseded", 409);
    if (parsed.promptHash !== row.prompt_hash)
      throw new EngineeringWorkflowError("PDD callback prompt hash does not match", 409);
    if (parsed.pddVersion !== row.pdd_version)
      throw new EngineeringWorkflowError("PDD callback version does not match the pinned runner version", 409);
    if (parsed.costUsd !== null && parsed.costUsd > Number(row.budget_usd))
      throw new EngineeringWorkflowError("PDD callback exceeded the verification budget", 409);
    const executionProfileSnapshot = validatedExecutionProfileBinding(row, "PDD verification");
    assertExecutionProfileNarrowing(executionProfileSnapshot, {
      permittedPaths: row.structured_snapshot.ticket.permittedPaths,
      requiredCommands: row.structured_snapshot.ticket.requiredCommands,
    });
    const verified = validateGeneratedTests(parsed, row.structured_snapshot);
    problemId = row.problem_id;
    promptId = row.prompt_revision_id;
    shouldRequestApproval = verified.status === "Ready for approval";
    await client.query(
      `UPDATE pdd_prompt_verifications SET status=$3,pdd_version=$4,model=$5,cost_usd=$6,
              summary=$7,generated_tests=$8,failure_message=$9,completed_at=now()
        WHERE org_id=$1 AND id=$2`,
      [orgId, verificationId, verified.status, verified.pddVersion, verified.model,
        verified.costUsd, verified.summary, JSON.stringify(verified.generatedTests), verified.failureMessage],
    );
    await audit(client, orgId, actor, `${verified.status}: ${verified.summary}`, "PddPromptVerification", verificationId);
    await enqueueBillingUsageEvent(client, {
      orgId,
      eventId: `user_story_test.completed:${orgId}:${verificationId}`,
      eventName: BILLING_EVENT_NAMES.userStoryTestCompleted,
      source: "closespan.pdd",
      properties: {
        verification_id: verificationId,
        status: verified.status,
        generated_tests: verified.generatedTests.length,
        cost_usd: verified.costUsd ?? 0,
        model: verified.model,
      },
    });
  });
  if (shouldRequestApproval) return requestImplementationApproval(orgId, promptId, actor);
  return postgresWorkflow(orgId, problemId);
}

export async function requestImplementationApproval(
  orgId: string,
  promptId: string,
  actor: ActorContext,
): Promise<EngineeringWorkflowView> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const entry = [...memoryWorkflows.values()].find((item) => item.prompt?.id === promptId);
    if (!entry?.prompt) throw new EngineeringWorkflowError("Implementation prompt was not found", 404);
    if (entry.prompt.status !== "Ready") throw new EngineeringWorkflowError("Only the latest ready prompt can be submitted", 409);
    if (entry.verification?.status !== "Ready for approval" || entry.verification.promptHash !== entry.prompt.contentHash)
      throw new EngineeringWorkflowError("Generate and review a PDD acceptance contract before requesting approval", 409);
    entry.prompt.status = "Awaiting approval";
    entry.specification.implementationState = "Awaiting approval";
    entry.approval = { id: `apr_prompt_${randomUUID().replaceAll("-", "")}`, status: "Pending", expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), promptHash: entry.prompt.contentHash, repository: entry.prompt.repository, baseBranch: entry.prompt.baseBranch, baseSha: entry.prompt.baseSha, allowedCapabilities: ["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"] };
    const pair = [...memoryWorkflows.entries()].find(([, item]) => item === entry);
    return getEngineeringWorkflow(orgId, pair?.[0].split(":").slice(1).join(":") ?? primaryProblem.id);
  }
  let problemId = "";
  await transaction(async (client) => {
    const prompt = await client.query<{
      id: string; problem_id: string; status: string; content_hash: string;
      repository: string; base_branch: string; base_sha: string;
    }>("SELECT id,problem_id,status,content_hash,repository,base_branch,base_sha FROM implementation_prompts WHERE org_id=$1 AND id=$2 FOR UPDATE", [orgId, promptId]);
    const row = prompt.rows[0];
    if (!row) throw new EngineeringWorkflowError("Implementation prompt was not found", 404);
    if (row.status !== "Ready") throw new EngineeringWorkflowError("Only the latest ready prompt can be submitted", 409);
    const verification = await client.query<ExecutionProfileBindingRow & { id: string }>(
      `SELECT id,execution_profile_id,execution_profile_hash,execution_profile_snapshot
         FROM pdd_prompt_verifications
        WHERE org_id=$1 AND prompt_revision_id=$2 AND prompt_hash=$3 AND status='Ready for approval'
        ORDER BY completed_at DESC LIMIT 1 FOR UPDATE`,
      [orgId, promptId, row.content_hash],
    );
    const verificationRow = verification.rows[0];
    if (!verificationRow)
      throw new EngineeringWorkflowError("Generate and review a PDD acceptance contract before requesting approval", 409);
    const executionProfileSnapshot = validatedExecutionProfileBinding(verificationRow, "PDD verification");
    problemId = row.problem_id;
    const approvalId = `apr_prompt_${randomUUID().replaceAll("-", "")}`;
    const capabilities = ["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"];
    await client.query(
      `INSERT INTO approval_requests(
        id,org_id,problem_id,recommendation_id,action,reason,confidence,systems,data_shared,
        reversible,risk,status,action_type,prompt_revision_id,prompt_hash,repository,base_branch,
        base_sha,allowed_capabilities,expires_at,pdd_verification_id,execution_profile_id,
        execution_profile_hash,execution_profile_snapshot
      ) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,true,'Medium','Pending','agent_run',$9,$10,$11,$12,$13,$14,now()+interval '30 minutes',$15,$16,$17,$18)`,
      [approvalId, orgId, row.problem_id, promptId,
        `Run one coding agent and open a draft PR in ${row.repository}`,
        "The approval is bound to an immutable prompt, PDD acceptance contract, base commit, repository, expiry, and single execution.",
        JSON.stringify(["Tenki Sandbox", "GitHub"]),
        JSON.stringify(["Approved prompt", "PDD acceptance contract", "Redacted evidence", "Repository snapshot"]),
        promptId, row.content_hash, row.repository, row.base_branch, row.base_sha,
        JSON.stringify(capabilities), verificationRow.id, executionProfileSnapshot.profileId,
        executionProfileSnapshot.contentHash, JSON.stringify(executionProfileSnapshot)],
    );
    await client.query("UPDATE implementation_prompts SET status='Awaiting approval' WHERE org_id=$1 AND id=$2", [orgId, promptId]);
    await client.query("UPDATE engineering_ticket_specifications SET implementation_state='Awaiting approval',updated_at=now() WHERE org_id=$1 AND problem_id=$2", [orgId, row.problem_id]);
    await audit(client, orgId, actor, `Requested one-run coding approval for prompt ${row.content_hash} and PDD verification ${verificationRow.id}`, "ApprovalRequest", approvalId);
  });
  return postgresWorkflow(orgId, problemId);
}

export async function approveImplementationRun(
  orgId: string,
  approvalId: string,
  actor: ActorContext,
): Promise<EngineeringWorkflowView> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const pair = [...memoryWorkflows.entries()].find(([, item]) => item.approval?.id === approvalId);
    if (!pair?.[1].approval || !pair[1].prompt) throw new EngineeringWorkflowError("Approval was not found", 404);
    const current = pair[1];
    const approval = current.approval;
    const prompt = current.prompt;
    if (!approval || !prompt) throw new EngineeringWorkflowError("Approval was not found", 404);
    if (approval.status !== "Pending") throw new EngineeringWorkflowError("Approval is no longer pending", 409);
    if (Date.parse(approval.expiresAt) <= Date.now()) {
      approval.status = "Expired";
      prompt.status = "Ready";
      current.specification.implementationState = "Prompt ready";
      throw new EngineeringWorkflowError("Approval expired; generate a fresh approval", 409);
    }
    approval.status = "Approved";
    prompt.status = "Approved";
    current.specification.implementationState = "Running";
    const runId = randomUUID();
    current.run = { id: runId, approvalId, status: "Queued", branchName: branchName(pair[0].split(":").slice(1).join(":"), runId, primaryProblem.title), changedFiles: [], testResults: [], criterionResults: [], failureCode: null, failureMessage: null, pullRequestUrl: null, queuedAt: new Date().toISOString(), completedAt: null };
    return getEngineeringWorkflow(orgId, pair[0].split(":").slice(1).join(":"));
  }
  let problemId = "";
  let expired = false;
  await transaction(async (client) => {
    const approval = await client.query<{
      id: string; problem_id: string; status: EngineeringApprovalView["status"];
      expires_at: Date; prompt_revision_id: string; prompt_hash: string;
      repository: string; base_branch: string; base_sha: string;
      pdd_verification_id: string | null;
      execution_profile_id: string | null; execution_profile_hash: string | null;
      execution_profile_snapshot: unknown;
    }>(`SELECT id,problem_id,status,expires_at,prompt_revision_id,prompt_hash,repository,base_branch,base_sha,
                pdd_verification_id,execution_profile_id,execution_profile_hash,execution_profile_snapshot
          FROM approval_requests
         WHERE org_id=$1 AND id=$2 AND action_type='agent_run' FOR UPDATE`, [orgId, approvalId]);
    const row = approval.rows[0];
    if (!row) throw new EngineeringWorkflowError("Approval was not found", 404);
    problemId = row.problem_id;
    if (row.status !== "Pending") throw new EngineeringWorkflowError("Approval is no longer pending", 409);
    if (row.expires_at.getTime() <= Date.now()) {
      await client.query("UPDATE approval_requests SET status='Expired',updated_at=now() WHERE org_id=$1 AND id=$2", [orgId, approvalId]);
      await client.query("UPDATE implementation_prompts SET status='Ready' WHERE org_id=$1 AND id=$2", [orgId, row.prompt_revision_id]);
      await client.query("UPDATE engineering_ticket_specifications SET implementation_state='Prompt ready',updated_at=now() WHERE org_id=$1 AND problem_id=$2", [orgId, row.problem_id]);
      expired = true;
      return;
    }
    const approvalProfile = validatedExecutionProfileBinding(row, "Approval request");
    const prompt = await client.query<{ content_hash: string; status: string }>(
      "SELECT content_hash,status FROM implementation_prompts WHERE org_id=$1 AND id=$2 FOR UPDATE",
      [orgId, row.prompt_revision_id],
    );
    if (!prompt.rows[0] || prompt.rows[0].content_hash !== row.prompt_hash || prompt.rows[0].status !== "Awaiting approval") {
      throw new EngineeringWorkflowError("The approved prompt no longer matches the immutable review payload", 409);
    }
    const repository = await client.query(
      "SELECT 1 FROM github_repository_allowlists WHERE org_id=$1 AND repository=$2 AND active=true",
      [orgId, row.repository],
    );
    if (!repository.rowCount) throw new EngineeringWorkflowError("The target repository is not allowlisted for agent execution", 409);
    const verification = row.pdd_verification_id
      ? await client.query<{ id: string } & ExecutionProfileBindingRow>(
          `SELECT id,execution_profile_id,execution_profile_hash,execution_profile_snapshot
             FROM pdd_prompt_verifications
            WHERE org_id=$1 AND id=$2 AND prompt_revision_id=$3 AND prompt_hash=$4
              AND status='Ready for approval' FOR UPDATE`,
          [orgId, row.pdd_verification_id, row.prompt_revision_id, row.prompt_hash],
        )
      : await client.query<{ id: string } & ExecutionProfileBindingRow>(
          `SELECT id,execution_profile_id,execution_profile_hash,execution_profile_snapshot
             FROM pdd_prompt_verifications
            WHERE org_id=$1 AND prompt_revision_id=$2 AND prompt_hash=$3 AND status='Ready for approval'
            ORDER BY completed_at DESC LIMIT 1 FOR UPDATE`,
          [orgId, row.prompt_revision_id, row.prompt_hash],
        );
    const verificationRow = verification.rows[0];
    if (!verificationRow) throw new EngineeringWorkflowError("The PDD acceptance contract is no longer ready", 409);
    const verificationProfile = validatedExecutionProfileBinding(verificationRow, "PDD verification");
    if (!sameExecutionProfileBinding(approvalProfile, verificationProfile)) {
      throw new EngineeringWorkflowError("The approval no longer matches the PDD execution profile", 409);
    }
    if (!row.pdd_verification_id) {
      const bound = await client.query(
        `UPDATE approval_requests SET pdd_verification_id=$3,updated_at=now()
          WHERE org_id=$1 AND id=$2 AND pdd_verification_id IS NULL`,
        [orgId, approvalId, verificationRow.id],
      );
      if (!bound.rowCount) {
        throw new EngineeringWorkflowError("The approval's PDD acceptance contract changed before execution", 409);
      }
    }
    const title = await client.query<{ title: string }>("SELECT title FROM product_problems WHERE org_id=$1 AND id=$2", [orgId, row.problem_id]);
    const runId = randomUUID();
    await client.query("UPDATE approval_requests SET status='Approved',consumed_at=now(),updated_at=now() WHERE org_id=$1 AND id=$2", [orgId, approvalId]);
    await client.query("UPDATE implementation_prompts SET status='Approved' WHERE org_id=$1 AND id=$2", [orgId, row.prompt_revision_id]);
    await client.query(
      `INSERT INTO agent_runs(id,org_id,problem_id,prompt_revision_id,approval_id,status,repository,
        base_branch,base_sha,branch_name,prompt_hash,pdd_verification_id,execution_profile_id,
        execution_profile_hash,execution_profile_snapshot)
       VALUES($1,$2,$3,$4,$5,'Queued',$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [runId, orgId, row.problem_id, row.prompt_revision_id, approvalId, row.repository,
        row.base_branch, row.base_sha, branchName(row.problem_id, runId, title.rows[0]?.title ?? "ticket"), row.prompt_hash,
        verificationRow.id, approvalProfile.profileId, approvalProfile.contentHash,
        JSON.stringify(approvalProfile)],
    );
    await client.query("UPDATE engineering_ticket_specifications SET implementation_state='Running',updated_at=now() WHERE org_id=$1 AND problem_id=$2", [orgId, row.problem_id]);
    await audit(client, orgId, actor, `Approved and queued one coding run ${runId} for prompt ${row.prompt_hash}`, "AgentRun", runId);
  });
  if (expired) throw new EngineeringWorkflowError("Approval expired; generate a fresh approval", 409);
  return postgresWorkflow(orgId, problemId);
}

export async function rejectImplementationApproval(
  orgId: string,
  approvalId: string,
  actor: ActorContext,
): Promise<EngineeringWorkflowView> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const pair = [...memoryWorkflows.entries()].find(([, item]) => item.approval?.id === approvalId);
    if (!pair?.[1].approval) throw new EngineeringWorkflowError("Approval was not found", 404);
    if (pair[1].approval.status !== "Pending") throw new EngineeringWorkflowError("Approval is no longer pending", 409);
    pair[1].approval.status = "Rejected";
    if (pair[1].prompt) pair[1].prompt.status = "Ready";
    pair[1].specification.implementationState = "Prompt ready";
    return getEngineeringWorkflow(orgId, pair[0].split(":").slice(1).join(":"));
  }
  let problemId = "";
  await transaction(async (client) => {
    const result = await client.query<{ problem_id: string; prompt_revision_id: string }>(
      `UPDATE approval_requests SET status='Rejected',updated_at=now()
        WHERE org_id=$1 AND id=$2 AND action_type='agent_run' AND status='Pending'
        RETURNING problem_id,prompt_revision_id`, [orgId, approvalId],
    );
    if (!result.rows[0]) throw new EngineeringWorkflowError("Approval is no longer pending", 409);
    problemId = result.rows[0].problem_id;
    await client.query("UPDATE implementation_prompts SET status='Ready' WHERE org_id=$1 AND id=$2", [orgId, result.rows[0].prompt_revision_id]);
    await client.query("UPDATE engineering_ticket_specifications SET implementation_state='Prompt ready',updated_at=now() WHERE org_id=$1 AND problem_id=$2", [orgId, problemId]);
    await audit(client, orgId, actor, "Rejected approval-bound coding run", "ApprovalRequest", approvalId);
  });
  return postgresWorkflow(orgId, problemId);
}

export function resetMemoryEngineeringWorkflows(): void {
  memoryWorkflows.clear();
}

export async function getAgentRunExecutionContext(
  orgId: string,
  runId: string,
): Promise<AgentRunExecutionContext> {
  if (workspacePersistenceMode(orgId) === "memory")
    throw new EngineeringWorkflowError("Live agent execution is unavailable in the seeded memory workspace", 409);
  const result = await databasePool().query<{
    problem_id: string; approval_id: string; repository: string; installation_id: string;
    base_branch: string; base_sha: string; branch_name: string; prompt_revision_id: string;
    prompt_hash: string; rendered_content: string; artifact_path: string;
    structured_snapshot: ImplementationPromptSnapshot; expires_at: Date; allowed_capabilities: string[];
    generated_tests: PddGeneratedTest[];
    run_pdd_verification_id: string | null;
    approval_pdd_verification_id: string | null;
    run_execution_profile_id: string | null; run_execution_profile_hash: string | null;
    run_execution_profile_snapshot: unknown;
    approval_execution_profile_id: string | null; approval_execution_profile_hash: string | null;
    approval_execution_profile_snapshot: unknown;
    verification_execution_profile_id: string | null; verification_execution_profile_hash: string | null;
    verification_execution_profile_snapshot: unknown;
  }>(`SELECT run.problem_id,run.approval_id,run.repository,allowlist.installation_id::text,
             run.base_branch,run.base_sha,run.branch_name,run.prompt_revision_id,run.prompt_hash,
             prompt.rendered_content,prompt.artifact_path,prompt.structured_snapshot,
             approval.expires_at,approval.allowed_capabilities,verification.generated_tests,
             run.pdd_verification_id AS run_pdd_verification_id,
             approval.pdd_verification_id AS approval_pdd_verification_id,
             run.execution_profile_id AS run_execution_profile_id,
             run.execution_profile_hash AS run_execution_profile_hash,
             run.execution_profile_snapshot AS run_execution_profile_snapshot,
             approval.execution_profile_id AS approval_execution_profile_id,
             approval.execution_profile_hash AS approval_execution_profile_hash,
             approval.execution_profile_snapshot AS approval_execution_profile_snapshot,
             verification.execution_profile_id AS verification_execution_profile_id,
             verification.execution_profile_hash AS verification_execution_profile_hash,
             verification.execution_profile_snapshot AS verification_execution_profile_snapshot
        FROM agent_runs run
        JOIN implementation_prompts prompt ON prompt.org_id=run.org_id AND prompt.id=run.prompt_revision_id
        JOIN approval_requests approval ON approval.org_id=run.org_id AND approval.id=run.approval_id
        JOIN pdd_prompt_verifications verification ON verification.org_id=run.org_id
          AND verification.id=run.pdd_verification_id
        JOIN github_repository_allowlists allowlist ON allowlist.org_id=run.org_id
          AND allowlist.repository=run.repository AND allowlist.active=true
       WHERE run.org_id=$1 AND run.id=$2`, [orgId, runId]);
  const row = result.rows[0];
  if (!row) throw new EngineeringWorkflowError("Agent run or repository authorization was not found", 404);
  if (
    !row.run_pdd_verification_id
    || !row.approval_pdd_verification_id
    || row.run_pdd_verification_id !== row.approval_pdd_verification_id
  ) {
    throw new EngineeringWorkflowError(
      "Agent run PDD verification no longer matches its approval-bound acceptance contract",
      409,
    );
  }
  const executionProfileSnapshot = validatedExecutionProfileBinding({
    execution_profile_id: row.run_execution_profile_id,
    execution_profile_hash: row.run_execution_profile_hash,
    execution_profile_snapshot: row.run_execution_profile_snapshot,
  }, "Agent run");
  const approvalProfile = validatedExecutionProfileBinding({
    execution_profile_id: row.approval_execution_profile_id,
    execution_profile_hash: row.approval_execution_profile_hash,
    execution_profile_snapshot: row.approval_execution_profile_snapshot,
  }, "Approval request");
  const verificationProfile = validatedExecutionProfileBinding({
    execution_profile_id: row.verification_execution_profile_id,
    execution_profile_hash: row.verification_execution_profile_hash,
    execution_profile_snapshot: row.verification_execution_profile_snapshot,
  }, "PDD verification");
  if (
    !sameExecutionProfileBinding(executionProfileSnapshot, approvalProfile)
    || !sameExecutionProfileBinding(executionProfileSnapshot, verificationProfile)
  ) {
    throw new EngineeringWorkflowError("Agent run execution profile no longer matches its approval chain", 409);
  }
  assertExecutionProfileNarrowing(executionProfileSnapshot, {
    permittedPaths: row.structured_snapshot.ticket.permittedPaths,
    requiredCommands: row.structured_snapshot.ticket.requiredCommands,
  });
  return {
    orgId, problemId: row.problem_id, runId, approvalId: row.approval_id,
    repository: row.repository, installationId: row.installation_id,
    baseBranch: row.base_branch, baseSha: row.base_sha, branchName: row.branch_name,
    promptId: row.prompt_revision_id, promptHash: row.prompt_hash,
    promptContent: row.rendered_content, promptArtifactPath: row.artifact_path,
    promptSnapshot: row.structured_snapshot,
    expiresAt: row.expires_at.toISOString(), allowedCapabilities: row.allowed_capabilities,
    generatedTests: row.generated_tests,
    executionProfileId: executionProfileSnapshot.profileId,
    executionProfileHash: executionProfileSnapshot.contentHash,
    executionProfileSnapshot,
  };
}

export async function markAgentRunRunning(
  orgId: string,
  runId: string,
  sandboxId: string,
): Promise<void> {
  const result = await databasePool().query(
    `UPDATE agent_runs SET status='Running',sandbox_id=$3,started_at=coalesce(started_at,now())
      WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Running')`,
    [orgId, runId, sandboxId],
  );
  if (!result.rowCount) throw new EngineeringWorkflowError("Agent run cannot be started", 409);
}

export async function claimQueuedAgentRun(
  orgId: string,
  runId: string,
): Promise<"claimed" | "active" | "terminal"> {
  if (workspacePersistenceMode(orgId) === "memory") return "terminal";
  const result = await databasePool().query<{ status: AgentRunView["status"] }>(
    `UPDATE agent_runs
        SET status='Running',sandbox_id='tenki:provisioning',started_at=coalesce(started_at,now())
      WHERE org_id=$1 AND id=$2
        AND (status='Queued' OR (status='Running' AND started_at < now()-interval '13 minutes'))
      RETURNING status`,
    [orgId, runId],
  );
  if (result.rowCount) return "claimed";
  const current = await databasePool().query<{ status: AgentRunView["status"] }>(
    "SELECT status FROM agent_runs WHERE org_id=$1 AND id=$2",
    [orgId, runId],
  );
  if (current.rows[0]?.status === "Running") return "active";
  return "terminal";
}

export async function completeAgentRun(
  context: AgentRunExecutionContext,
  input: unknown,
  publication?: {
    promptCommitSha: string;
    implementationCommitSha: string;
    pullRequestNumber: number;
    pullRequestUrl: string;
  },
): Promise<EngineeringWorkflowView> {
  const report = validateAgentImplementationReport(input, {
    runId: context.runId,
    promptHash: context.promptHash,
    baseSha: context.baseSha,
    promptArtifactPath: context.promptArtifactPath,
    promptSnapshot: context.promptSnapshot,
  });
  const finalStatus: AgentRunView["status"] = publication
    ? "Draft PR opened"
    : report.status === "No changes"
      ? "No changes"
      : report.status === "Failed"
        ? "Failed"
        : "Tests passed";
  await transaction(async (client) => {
    const locked = await client.query<{
      status: AgentRunView["status"];
      started_at: Date | null;
    }>(
      "SELECT status,started_at FROM agent_runs WHERE org_id=$1 AND id=$2 FOR UPDATE",
      [context.orgId, context.runId],
    );
    if (!locked.rows[0] || !["Queued", "Running", "Tests passed"].includes(locked.rows[0].status))
      throw new EngineeringWorkflowError("Agent run is already terminal", 409);
    await client.query(
      `UPDATE agent_runs SET status=$3,changed_files=$4,test_results=$5,implementation_report=$6,
         failure_code=$7,failure_message=$8,prompt_commit_sha=$9,implementation_commit_sha=$10,
         pull_request_number=$11,pull_request_url=$12,completed_at=CASE WHEN $3 IN ('Draft PR opened','Failed','No changes') THEN now() ELSE completed_at END
       WHERE org_id=$1 AND id=$2`,
      [context.orgId, context.runId, finalStatus,
        JSON.stringify(report.changedFiles.map((file) => file.path)), JSON.stringify(report.tests), JSON.stringify(report),
        finalStatus === "Failed" ? "agent_reported_failure" : null,
        finalStatus === "Failed" ? report.summary : null,
        publication?.promptCommitSha ?? null, publication?.implementationCommitSha ?? null,
        publication?.pullRequestNumber ?? null, publication?.pullRequestUrl ?? null],
    );
    await client.query("DELETE FROM agent_run_criterion_results WHERE org_id=$1 AND run_id=$2", [context.orgId, context.runId]);
    for (const result of report.criteria) {
      await client.query(
        `INSERT INTO agent_run_criterion_results(org_id,run_id,criterion_id,status,evidence,scenario_ids)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [context.orgId, context.runId, result.criterionId, result.status, result.evidence, JSON.stringify(result.scenarioIds)],
      );
    }
    if (publication) {
      await createFinalExecutionApproval(client, {
        orgId: context.orgId,
        problemId: context.problemId,
        runId: context.runId,
        promptRevisionId: context.promptId,
        repository: context.repository,
        baseBranch: context.baseBranch,
        pullRequestNumber: publication.pullRequestNumber,
        pullRequestUrl: publication.pullRequestUrl,
        headSha: publication.implementationCommitSha,
        changedFiles: report.changedFiles.map((file) => file.path),
        tests: report.tests,
        criteria: report.criteria,
        remainingRisks: report.remainingRisks,
        independentVerification: report.independentVerification,
        uiBaseline: report.uiBaseline ?? null,
        promptHash: context.promptHash,
        targetEnvironment: process.env.DEFAULT_DEPLOYMENT_ENVIRONMENT?.trim() || null,
        autoDeployOnMerge: process.env.AUTO_DEPLOY_ON_MERGE === "true",
        rollbackPlan: process.env.DEFAULT_ROLLBACK_PLAN?.trim() || null,
      });
    }
    const implementationState: EngineeringImplementationState = publication
      ? "Draft PR opened"
      : finalStatus === "Tests passed"
        ? "Tests passed"
        : "Prompt ready";
    await client.query("UPDATE engineering_ticket_specifications SET implementation_state=$3,updated_at=now() WHERE org_id=$1 AND problem_id=$2", [context.orgId, context.problemId, implementationState]);
    await client.query(
      `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
       VALUES($1,$2,'agent_executor','CloseSpan agent executor',$3,'AgentRun',$4,$5)`,
      [randomUUID(), context.orgId, `Agent run ${context.runId} completed as ${finalStatus}`, context.runId, `agent_run_${context.runId}_${randomUUID()}`],
    );
    if (["Draft PR opened", "Failed", "No changes"].includes(finalStatus)) {
      const startedAt = locked.rows[0]?.started_at;
      await enqueueBillingUsageEvent(client, {
        orgId: context.orgId,
        eventId: `agent_run.completed:${context.orgId}:${context.runId}`,
        eventName: BILLING_EVENT_NAMES.agentRunCompleted,
        source: "closespan.tenki",
        properties: {
          run_id: context.runId,
          status: finalStatus,
          changed_files: report.changedFiles.length,
          tests: report.tests.length,
          duration_seconds: startedAt
            ? Math.max(0, Math.round((Date.now() - startedAt.valueOf()) / 1_000))
            : 0,
        },
      });
    }
  });
  return postgresWorkflow(context.orgId, context.problemId);
}

export async function failAgentRun(
  context: AgentRunExecutionContext,
  code: string,
  message: string,
): Promise<void> {
  await transaction(async (client) => {
    const result = await client.query<{ started_at: Date | null }>(
      `UPDATE agent_runs SET status='Failed',failure_code=$3,failure_message=$4,completed_at=now()
        WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Running','Tests passed')
        RETURNING started_at`,
      [context.orgId, context.runId, code.slice(0, 120), message.slice(0, 2_000)],
    );
    if (!result.rowCount) return;
    await client.query(
      "UPDATE engineering_ticket_specifications SET implementation_state='Prompt ready',updated_at=now() WHERE org_id=$1 AND problem_id=$2",
      [context.orgId, context.problemId],
    );
    await client.query(
      `INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id)
       VALUES($1,$2,'agent_executor','CloseSpan agent executor',$3,'AgentRun',$4,$5)`,
      [randomUUID(), context.orgId, `Agent run failed: ${code.slice(0, 120)}`, context.runId, `agent_run_failed_${context.runId}_${randomUUID()}`],
    );
    const startedAt = result.rows[0]?.started_at;
    await enqueueBillingUsageEvent(client, {
      orgId: context.orgId,
      eventId: `agent_run.completed:${context.orgId}:${context.runId}`,
      eventName: BILLING_EVENT_NAMES.agentRunCompleted,
      source: "closespan.tenki",
      properties: {
        run_id: context.runId,
        status: "Failed",
        failure_code: code.slice(0, 120),
        duration_seconds: startedAt
          ? Math.max(0, Math.round((Date.now() - startedAt.valueOf()) / 1_000))
          : 0,
      },
    });
  });
}

export async function recordReleaseVerification(
  orgId: string,
  problemId: string,
  input: { status?: unknown; environment?: unknown; evidence?: unknown },
  actor: ActorContext,
): Promise<EngineeringWorkflowView> {
  const status = input.status === "Passed" || input.status === "Failed" ? input.status : null;
  const environment = typeof input.environment === "string" ? input.environment.trim() : "";
  const evidence = typeof input.evidence === "string" ? input.evidence.trim() : "";
  if (!status) throw new EngineeringWorkflowError("Release verification status must be Passed or Failed", 400);
  if (environment.length < 2 || environment.length > 200) throw new EngineeringWorkflowError("Release environment is required", 400);
  if (evidence.length < 10 || evidence.length > 10_000) throw new EngineeringWorkflowError("Release evidence must explain what was verified", 400);
  if (workspacePersistenceMode(orgId) === "memory") {
    const current = memoryWorkflow(orgId, problemId);
    current.releaseEvidence = {
      id: randomUUID(), status, environment, evidence,
      specificationRevision: current.specification.revision ?? 1,
      verifiedBy: actor.actorName, verifiedAt: new Date().toISOString(),
    };
    return getEngineeringWorkflow(orgId, problemId);
  }
  await transaction(async (client) => {
    const problem = await client.query<{ stage: string }>(
      "SELECT stage FROM product_problems WHERE org_id=$1 AND id=$2 FOR UPDATE",
      [orgId, problemId],
    );
    if (!problem.rows[0]) throw new EngineeringWorkflowError("Product problem was not found", 404);
    if (problem.rows[0].stage !== "Released")
      throw new EngineeringWorkflowError("Release verification can only be recorded after the problem reaches Released", 409);
    const specification = await client.query<{ id: string; revision: number }>(
      "SELECT id,revision FROM engineering_ticket_specifications WHERE org_id=$1 AND problem_id=$2",
      [orgId, problemId],
    );
    const row = specification.rows[0];
    if (!row) throw new EngineeringWorkflowError("Engineering specification was not found", 404);
    const id = randomUUID();
    await client.query(
      `INSERT INTO engineering_release_verifications(
         id,org_id,problem_id,specification_id,specification_revision,status,
         environment,evidence,verified_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, orgId, problemId, row.id, row.revision, status, environment, evidence, actor.actorName],
    );
    await audit(client, orgId, actor, `Recorded ${status.toLowerCase()} release verification in ${environment}`, "ReleaseVerification", id);
  });
  return postgresWorkflow(orgId, problemId);
}

export async function cancelAgentRun(orgId: string, runId: string, actor: ActorContext): Promise<EngineeringWorkflowView> {
  if (workspacePersistenceMode(orgId) === "memory") {
    const pair = [...memoryWorkflows.entries()].find(([key, item]) => key.startsWith(`${orgId}:`) && item.run?.id === runId);
    if (!pair?.[1].run || !["Queued", "Running"].includes(pair[1].run.status)) throw new EngineeringWorkflowError("Agent run cannot be cancelled", 409);
    pair[1].run.status = "Cancelled";
    pair[1].run.completedAt = new Date().toISOString();
    pair[1].specification.implementationState = "Prompt ready";
    return getEngineeringWorkflow(orgId, pair[0].slice(orgId.length + 1));
  }
  let problemId = "";
  await transaction(async (client) => {
    const result = await client.query<{ problem_id: string }>(
      `UPDATE agent_runs SET status='Cancelled',completed_at=now()
        WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Running') RETURNING problem_id`,
      [orgId, runId],
    );
    if (!result.rows[0]) throw new EngineeringWorkflowError("Agent run cannot be cancelled", 409);
    problemId = result.rows[0].problem_id;
    await client.query("UPDATE engineering_ticket_specifications SET implementation_state='Prompt ready',updated_at=now() WHERE org_id=$1 AND problem_id=$2", [orgId, problemId]);
    await audit(client, orgId, actor, "Cancelled approval-bound agent run", "AgentRun", runId);
  });
  return postgresWorkflow(orgId, problemId);
}

export function verificationReportJson(report: AgentImplementationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
