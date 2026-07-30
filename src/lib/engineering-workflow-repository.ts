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
import {
  validateAgentImplementationReport,
  type AgentImplementationReport,
} from "./agent-run-verification";
import {
  evaluateUserStoryPromptMatch,
  userStoryInputIssue,
} from "./user-story-prompt-test";

export interface ImplementationPromptView {
  id: string;
  revision: number;
  status: "Ready" | "Awaiting approval" | "Approved" | "Superseded";
  artifactPath: string;
  content: string;
  contentHash: string;
  repository: string;
  baseBranch: string;
  baseSha: string;
  createdAt: string;
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

export interface AgentRunView {
  id: string;
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
  independentVerification?: AgentImplementationReport["independentVerification"];
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
  approval: EngineeringApprovalView | null;
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
}

export interface UserStoryPromptTestView {
  status: "included" | "not-included";
  message: string;
  promptHash: string;
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
  }>(`SELECT id,revision,status,artifact_path,rendered_content,content_hash,
             repository,base_branch,base_sha,created_at
        FROM implementation_prompts
       WHERE org_id=$1 AND problem_id=$2
       ORDER BY revision DESC LIMIT 1`, [orgId, problemId]);
  const row = result.rows[0];
  return row ? {
    id: row.id, revision: row.revision, status: row.status,
    artifactPath: row.artifact_path, content: row.rendered_content,
    contentHash: row.content_hash, repository: row.repository,
    baseBranch: row.base_branch, baseSha: row.base_sha,
    createdAt: row.created_at.toISOString(),
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
    id: string; status: AgentRunView["status"]; branch_name: string;
    changed_files: string[]; test_results: AgentTestResult[]; failure_code: string | null;
    failure_message: string | null; pull_request_url: string | null;
    queued_at: Date; completed_at: Date | null; implementation_report: AgentImplementationReport | null;
  }>(`SELECT id,status,branch_name,changed_files,test_results,failure_code,
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
    id: row.id, status: row.status, branchName: row.branch_name,
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

async function postgresWorkflow(orgId: string, problemId: string): Promise<EngineeringWorkflowView> {
  const pool = databasePool();
  const [specification, prompt, approval, run, releaseEvidence] = await Promise.all([
    readSpecification(pool, orgId, problemId),
    readPrompt(pool, orgId, problemId),
    readApproval(pool, orgId, problemId),
    readRun(pool, orgId, problemId),
    readReleaseEvidence(pool, orgId, problemId),
  ]);
  return { problemId, specification, readiness: ticketReadiness(specification), prompt, approval, run, releaseEvidence };
}

async function readReleaseEvidence(database: Pool | PoolClient, orgId: string, problemId: string): Promise<ReleaseVerificationEvidence | null> {
  const result = await database.query<{
    id: string; status: "Passed" | "Failed"; environment: string; evidence: string;
    specification_revision: number; verified_by: string; verified_at: Date;
  }>(`SELECT id,status,environment,evidence,specification_revision,verified_by,verified_at
        FROM engineering_release_verifications
       WHERE org_id=$1 AND problem_id=$2 ORDER BY verified_at DESC,id DESC LIMIT 1`, [orgId, problemId]);
  const row = result.rows[0];
  return row ? {
    id: row.id, status: row.status, environment: row.environment, evidence: row.evidence,
    specificationRevision: row.specification_revision, verifiedBy: row.verified_by,
    verifiedAt: row.verified_at.toISOString(),
  } : null;
}

interface MemoryWorkflow {
  specification: EngineeringTicketSpecification;
  prompt: ImplementationPromptView | null;
  approval: EngineeringApprovalView | null;
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
    current = { specification: defaultSpecification(problemId), prompt: null, approval: null, run: null, releaseEvidence: null };
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
    current.specification = { ...draft, id: current.specification.id ?? randomUUID(), revision: (current.specification.revision ?? 0) + 1, implementationState: "Draft specification" };
    if (current.prompt) current.prompt.status = "Superseded";
    if (current.approval?.status === "Pending") current.approval.status = "Superseded";
    return getEngineeringWorkflow(orgId, problemId);
  }
  await transaction(async (client) => {
    await assertProblem(client, orgId, problemId);
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
    await client.query("UPDATE approval_requests SET status='Superseded',updated_at=now() WHERE org_id=$1 AND problem_id=$2 AND action_type='agent_run' AND status='Pending'", [orgId, problemId]);
    await audit(client, orgId, actor, `Saved engineering ticket specification revision ${revision}; prior pending prompt approvals were superseded`, "EngineeringTicket", problemId);
  });
  return postgresWorkflow(orgId, problemId);
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

export async function testUserStoryAgainstPrompt(
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
      "Ticket context is incomplete. CloseSpan could not build a testable prompt yet.",
      409,
    );
  }
  if (!workflow.prompt || workflow.prompt.status === "Superseded") {
    if (!workflow.readiness.ready) {
      throw new EngineeringWorkflowError(
        "Ticket context is incomplete. CloseSpan could not build a testable prompt yet.",
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
  const result = evaluateUserStoryPromptMatch(story, prompt.content);
  if (result.matches && prompt.status === "Ready") {
    workflow = await requestImplementationApproval(
      orgId,
      prompt.id,
      actor,
    );
  }
  return {
    workflow,
    storyTest: {
      status: result.matches ? "included" : "not-included",
      message: result.matches
        ? "This exact user story is included in the implementation prompt."
        : "This user story is not included in the current implementation prompt.",
      promptHash: prompt.contentHash,
    },
  };
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
    problemId = row.problem_id;
    const approvalId = `apr_prompt_${randomUUID().replaceAll("-", "")}`;
    const capabilities = ["repository:read", "repository:write", "tests:execute", "pull_requests:write:draft"];
    await client.query(
      `INSERT INTO approval_requests(
        id,org_id,problem_id,recommendation_id,action,reason,confidence,systems,data_shared,
        reversible,risk,status,action_type,prompt_revision_id,prompt_hash,repository,base_branch,
        base_sha,allowed_capabilities,expires_at
      ) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,true,'Medium','Pending','agent_run',$9,$10,$11,$12,$13,$14,now()+interval '30 minutes')`,
      [approvalId, orgId, row.problem_id, promptId,
        `Run one coding agent and open a draft PR in ${row.repository}`,
        "The approval is bound to an immutable prompt, base commit, repository, expiry, and single execution.",
        JSON.stringify(["Tenki Sandbox", "GitHub"]),
        JSON.stringify(["Approved prompt", "Redacted evidence", "Repository snapshot"]),
        promptId, row.content_hash, row.repository, row.base_branch, row.base_sha,
        JSON.stringify(capabilities)],
    );
    await client.query("UPDATE implementation_prompts SET status='Awaiting approval' WHERE org_id=$1 AND id=$2", [orgId, promptId]);
    await client.query("UPDATE engineering_ticket_specifications SET implementation_state='Awaiting approval',updated_at=now() WHERE org_id=$1 AND problem_id=$2", [orgId, row.problem_id]);
    await audit(client, orgId, actor, `Requested one-run coding approval for prompt ${row.content_hash}`, "ApprovalRequest", approvalId);
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
    current.run = { id: runId, status: "Queued", branchName: branchName(pair[0].split(":").slice(1).join(":"), runId, primaryProblem.title), changedFiles: [], testResults: [], criterionResults: [], failureCode: null, failureMessage: null, pullRequestUrl: null, queuedAt: new Date().toISOString(), completedAt: null };
    return getEngineeringWorkflow(orgId, pair[0].split(":").slice(1).join(":"));
  }
  let problemId = "";
  let expired = false;
  await transaction(async (client) => {
    const approval = await client.query<{
      id: string; problem_id: string; status: EngineeringApprovalView["status"];
      expires_at: Date; prompt_revision_id: string; prompt_hash: string;
      repository: string; base_branch: string; base_sha: string;
    }>(`SELECT id,problem_id,status,expires_at,prompt_revision_id,prompt_hash,repository,base_branch,base_sha
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
    const title = await client.query<{ title: string }>("SELECT title FROM product_problems WHERE org_id=$1 AND id=$2", [orgId, row.problem_id]);
    const runId = randomUUID();
    await client.query("UPDATE approval_requests SET status='Approved',consumed_at=now(),updated_at=now() WHERE org_id=$1 AND id=$2", [orgId, approvalId]);
    await client.query("UPDATE implementation_prompts SET status='Approved' WHERE org_id=$1 AND id=$2", [orgId, row.prompt_revision_id]);
    await client.query(
      `INSERT INTO agent_runs(id,org_id,problem_id,prompt_revision_id,approval_id,status,repository,
        base_branch,base_sha,branch_name,prompt_hash)
       VALUES($1,$2,$3,$4,$5,'Queued',$6,$7,$8,$9,$10)`,
      [runId, orgId, row.problem_id, row.prompt_revision_id, approvalId, row.repository,
        row.base_branch, row.base_sha, branchName(row.problem_id, runId, title.rows[0]?.title ?? "ticket"), row.prompt_hash],
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
  }>(`SELECT run.problem_id,run.approval_id,run.repository,allowlist.installation_id::text,
             run.base_branch,run.base_sha,run.branch_name,run.prompt_revision_id,run.prompt_hash,
             prompt.rendered_content,prompt.artifact_path,prompt.structured_snapshot,
             approval.expires_at,approval.allowed_capabilities
        FROM agent_runs run
        JOIN implementation_prompts prompt ON prompt.org_id=run.org_id AND prompt.id=run.prompt_revision_id
        JOIN approval_requests approval ON approval.org_id=run.org_id AND approval.id=run.approval_id
        JOIN github_repository_allowlists allowlist ON allowlist.org_id=run.org_id
          AND allowlist.repository=run.repository AND allowlist.active=true
       WHERE run.org_id=$1 AND run.id=$2`, [orgId, runId]);
  const row = result.rows[0];
  if (!row) throw new EngineeringWorkflowError("Agent run or repository authorization was not found", 404);
  return {
    orgId, problemId: row.problem_id, runId, approvalId: row.approval_id,
    repository: row.repository, installationId: row.installation_id,
    baseBranch: row.base_branch, baseSha: row.base_sha, branchName: row.branch_name,
    promptId: row.prompt_revision_id, promptHash: row.prompt_hash,
    promptContent: row.rendered_content, promptArtifactPath: row.artifact_path,
    promptSnapshot: row.structured_snapshot,
    expiresAt: row.expires_at.toISOString(), allowedCapabilities: row.allowed_capabilities,
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
    const locked = await client.query<{ status: AgentRunView["status"] }>(
      "SELECT status FROM agent_runs WHERE org_id=$1 AND id=$2 FOR UPDATE",
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
  });
  return postgresWorkflow(context.orgId, context.problemId);
}

export async function failAgentRun(
  context: AgentRunExecutionContext,
  code: string,
  message: string,
): Promise<void> {
  await transaction(async (client) => {
    const result = await client.query(
      `UPDATE agent_runs SET status='Failed',failure_code=$3,failure_message=$4,completed_at=now()
        WHERE org_id=$1 AND id=$2 AND status IN ('Queued','Running','Tests passed')`,
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
