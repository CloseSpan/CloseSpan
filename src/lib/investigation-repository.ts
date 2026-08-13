import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import type { Severity, Stage } from "./domain";
import { HttpError } from "./request-security";
import {
  primaryProblem as seedProblem,
  recommendation as seedRecommendation,
} from "./seed";
import { workspacePersistenceMode } from "./workspace-persistence";
import { runtimeVerificationFailureMessage } from "./runtime-verifier-errors";
import type { IssueRuntimeVerificationRunView } from "./issue-runtime-verification";

export interface InvestigationWorkspaceItem {
  id: string;
  problemId: string;
  problemTitle: string;
  title: string;
  status: string;
  confidence: number;
  signalConfidence: number;
  relatedSignalCount: number;
  severity: Severity;
  stage: Stage;
  productArea: string;
  team: string;
  repository: string;
  hypothesis: string;
  assumptions: string[];
  missingInformation: string[];
  proposedAction: string;
  recommendedTests: string[];
  suspectedFiles: string[];
  verification: InvestigationVerification;
  runtimeVerification?: IssueRuntimeVerificationRunView | null;
  updatedAt: string;
}

export type InvestigationVerificationStatus =
  | "Unverified"
  | "Confirmed current"
  | "Not reproduced"
  | "Already resolved"
  | "Verification blocked";

export type InvestigationVerificationMethod =
  | "Product reproduction"
  | "Automated check"
  | "Production telemetry"
  | "Release evidence";

export interface InvestigationVerification {
  status: InvestigationVerificationStatus;
  method: InvestigationVerificationMethod | null;
  summary: string | null;
  actorName: string | null;
  verifiedAt: string | null;
}

export interface AutomatedInvestigationResult {
  created: boolean;
  problemId: string | null;
  investigationId: string | null;
  confidence: number | null;
  reason: string;
}

interface InvestigationCandidateRow {
  id: string;
  title: string;
  statement: string;
  summary: string;
  confidence: number;
  product_area: string;
  suspected_files: unknown;
  evidence_count: number;
  feedback_types: unknown;
  feedback_quotes: unknown;
}

interface InvestigationRow {
  id: string;
  problem_id: string;
  problem_title: string;
  title: string;
  status: string;
  confidence: number;
  signal_confidence: number;
  related_signal_count: number;
  severity: Severity;
  stage: Stage;
  product_area: string;
  team: string;
  repository: string;
  hypothesis: string;
  assumptions: unknown;
  missing_information: unknown;
  proposed_action: string;
  recommended_tests: unknown;
  suspected_files: unknown;
  verification_status: InvestigationVerificationStatus;
  verification_method: InvestigationVerificationMethod | null;
  verification_summary: string | null;
  verification_actor_name: string | null;
  verified_at: Date | string | null;
  runtime_run_id?: string | null;
  runtime_status?: IssueRuntimeVerificationRunView["status"] | null;
  runtime_outcome?: IssueRuntimeVerificationRunView["outcome"];
  runtime_repository?: string | null;
  runtime_base_sha?: string | null;
  runtime_summary?: string | null;
  runtime_failure_message?: string | null;
  runtime_requested_by_name?: string | null;
  runtime_requested_at?: Date | string | null;
  runtime_started_at?: Date | string | null;
  runtime_completed_at?: Date | string | null;
  runtime_workflow_run_id?: string | number | null;
  updated_at: Date | string;
}

const VERIFICATION_STATUSES = new Set<InvestigationVerificationStatus>([
  "Confirmed current",
  "Not reproduced",
  "Already resolved",
  "Verification blocked",
]);

const VERIFICATION_METHODS = new Set<InvestigationVerificationMethod>([
  "Product reproduction",
  "Automated check",
  "Production telemetry",
  "Release evidence",
]);

const INTERNAL_CANARY_TITLE = /^(?:strict\s+)?production\b.*\bcanary\b/i;

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function investigationCopy(row: InvestigationCandidateRow) {
  const title = row.title.trim().replace(/\s+/g, " ");
  const statement = row.statement.trim().replace(/\s+/g, " ");
  const summary = row.summary.trim().replace(/\s+/g, " ");
  const quotes = stringArray(row.feedback_quotes);
  const feedbackTypes = stringArray(row.feedback_types);
  const isFeature = feedbackTypes.filter((type) => type === "Feature request").length
    > feedbackTypes.filter((type) => type === "Bug" || type === "Incident").length;
  const missingInformation = [
    "Exact reproduction steps and the expected result",
    "A failing trace, console error, or request identifier",
  ];
  if (quotes.length < 2) {
    missingInformation.push("A second independent customer report or internal reproduction");
  }
  return {
    title: `${row.product_area || "Product"} investigation`,
    hypothesis: isFeature
      ? `${title} reflects an unmet product need. The implementation scope is not yet confirmed.`
      : `${title} is consistent with a product defect, but the root cause is not yet confirmed.`,
    assumptions: [
      statement || summary || `The reported behavior is accurately represented by “${title}”.`,
      "The linked customer evidence belongs to the same product behavior.",
    ],
    missingInformation,
    proposedAction: isFeature
      ? `Trace the current ${row.product_area || "product"} workflow, confirm the expected outcome, and identify the smallest repository-scoped change that satisfies it.`
      : `Reproduce “${title}”, trace the affected ${row.product_area || "product"} path, and confirm the failure before changing implementation code.`,
    recommendedTests: isFeature
      ? [
          "Add an acceptance test for the expected user outcome",
          "Verify the existing workflow remains backward compatible",
        ]
      : [
          `Add a regression test that reproduces “${title}”`,
          "Verify the expected result and the nearest unaffected workflow",
        ],
    suspectedFiles: stringArray(row.suspected_files),
  };
}

async function readInvestigationCandidate(
  client: PoolClient,
  orgId: string,
  problemId?: string,
): Promise<InvestigationCandidateRow | null> {
  const result = await client.query<InvestigationCandidateRow>(
    `SELECT problem.id,problem.title,problem.statement,problem.summary,
            problem.confidence,problem.product_area,problem.suspected_files,
            count(membership.feedback_id)::int AS evidence_count,
            jsonb_agg(feedback.type ORDER BY feedback.created_at,feedback.id) AS feedback_types,
            jsonb_agg(feedback.quote ORDER BY feedback.created_at,feedback.id) AS feedback_quotes
       FROM product_problems problem
       JOIN feedback_cluster_memberships membership
         ON membership.org_id=problem.org_id AND membership.problem_id=problem.id
       JOIN feedback_items feedback
         ON feedback.org_id=membership.org_id AND feedback.id=membership.feedback_id
      WHERE problem.org_id=$1
        AND problem.stage <> 'Closed'
        AND ($2::text IS NULL OR problem.id=$2)
        AND feedback.type IN ('Bug','Incident','Feature request')
        AND NOT EXISTS (
          SELECT 1 FROM investigations existing
           WHERE existing.org_id=problem.org_id AND existing.problem_id=problem.id
        )
      GROUP BY problem.org_id,problem.id
      ORDER BY problem.confidence DESC,evidence_count DESC,problem.updated_at,problem.id
      LIMIT 1`,
    [orgId, problemId ?? null],
  );
  return result.rows[0] ?? null;
}

async function createInvestigation(
  client: PoolClient,
  orgId: string,
  row: InvestigationCandidateRow,
): Promise<AutomatedInvestigationResult> {
  const id = randomUUID();
  const confidence = Math.max(0, Math.min(1, Number(row.confidence)));
  const copy = investigationCopy(row);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO investigations(
       id,org_id,problem_id,title,status,hypothesis,confidence,assumptions,
       missing_information,proposed_action,recommended_tests,suspected_files
     )
     SELECT $1,$2,$3,$4,'Ready for review',$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM investigations existing WHERE existing.org_id=$2 AND existing.problem_id=$3
     )
     RETURNING id`,
    [
      id,
      orgId,
      row.id,
      copy.title,
      copy.hypothesis,
      confidence,
      JSON.stringify(copy.assumptions),
      JSON.stringify(copy.missingInformation),
      copy.proposedAction,
      JSON.stringify(copy.recommendedTests),
      JSON.stringify(copy.suspectedFiles),
    ],
  );
  if (!inserted.rows[0]) {
    return {
      created: false,
      problemId: row.id,
      investigationId: null,
      confidence: null,
      reason: "An investigation already exists for this problem.",
    };
  }
  await client.query(
    `INSERT INTO audit_events(
       id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
     ) VALUES($1,$2,'agent_investigator','Investigation agent',$3,'Investigation',$4,$5)`,
    [
      randomUUID(),
      orgId,
      `Created an evidence-bound investigation for ${row.evidence_count} customer signal${row.evidence_count === 1 ? "" : "s"}.`,
      id,
      `investigation:${row.id}:${id}`,
    ],
  );
  await client.query(
    "UPDATE workspaces SET version=version+1,updated_at=now() WHERE org_id=$1",
    [orgId],
  );
  return {
    created: true,
    problemId: row.id,
    investigationId: id,
    confidence,
    reason: "Created an evidence-bound investigation.",
  };
}

async function createPostgresInvestigation(
  orgId: string,
  problemId?: string,
): Promise<AutomatedInvestigationResult> {
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [`closespan-investigation:${orgId}`],
    );
    const row = await readInvestigationCandidate(client, orgId, problemId);
    if (!row) {
      return {
        created: false,
        problemId: problemId ?? null,
        investigationId: null,
        confidence: null,
        reason: "No uninvestigated bug or feature request has linked evidence.",
      };
    }
    return createInvestigation(client, orgId, row);
  });
}

export async function createNextAutomatedInvestigation(
  orgId: string,
): Promise<AutomatedInvestigationResult> {
  if (workspacePersistenceMode(orgId) === "memory") {
    return {
      created: false,
      problemId: seedProblem.id,
      investigationId: seedRecommendation.id,
      confidence: seedRecommendation.confidence,
      reason: "The demonstration investigation already exists.",
    };
  }
  return createPostgresInvestigation(orgId);
}

export async function createAutomatedInvestigationForProblem(
  orgId: string,
  problemId: string,
): Promise<AutomatedInvestigationResult> {
  if (workspacePersistenceMode(orgId) === "memory") {
    return problemId === seedProblem.id
      ? {
          created: false,
          problemId,
          investigationId: seedRecommendation.id,
          confidence: seedRecommendation.confidence,
          reason: "The demonstration investigation already exists.",
        }
      : {
          created: false,
          problemId,
          investigationId: null,
          confidence: null,
          reason: "This demonstration problem has no linked investigation evidence.",
        };
  }
  return createPostgresInvestigation(orgId, problemId);
}

export function isCustomerVisibleInvestigationTitle(title: string): boolean {
  return !INTERNAL_CANARY_TITLE.test(title.trim());
}

export function mapInvestigationWorkspaceRow(
  row: InvestigationRow,
): InvestigationWorkspaceItem {
  return {
    id: row.id,
    problemId: row.problem_id,
    problemTitle: row.problem_title,
    title: row.title,
    status: row.status,
    confidence: Number(row.confidence),
    signalConfidence: Number(row.signal_confidence),
    relatedSignalCount: Number(row.related_signal_count),
    severity: row.severity,
    stage: row.stage,
    productArea: row.product_area,
    team: row.team,
    repository: row.repository,
    hypothesis: row.hypothesis,
    assumptions: stringArray(row.assumptions),
    missingInformation: stringArray(row.missing_information),
    proposedAction: row.proposed_action,
    recommendedTests: stringArray(row.recommended_tests),
    suspectedFiles: stringArray(row.suspected_files),
    verification: {
      status: row.verification_status ?? "Unverified",
      method: row.verification_method,
      summary: row.verification_status === "Verification blocked"
        ? runtimeVerificationFailureMessage(row.verification_summary)
        : row.verification_summary,
      actorName: row.verification_actor_name,
      verifiedAt: row.verified_at
        ? row.verified_at instanceof Date
          ? row.verified_at.toISOString()
          : String(row.verified_at)
        : null,
    },
    runtimeVerification: row.runtime_run_id && row.runtime_status
      ? {
          id: row.runtime_run_id,
          status: row.runtime_status,
          outcome: row.runtime_outcome ?? null,
          repository: row.runtime_repository ?? row.repository,
          baseSha: row.runtime_base_sha ?? "",
          summary: row.runtime_status === "Failed"
            ? runtimeVerificationFailureMessage(row.runtime_summary ?? null)
            : row.runtime_summary ?? null,
          failureMessage: runtimeVerificationFailureMessage(row.runtime_failure_message ?? null),
          requestedByName: row.runtime_requested_by_name ?? "CloseSpan reviewer",
          requestedAt: row.runtime_requested_at instanceof Date
            ? row.runtime_requested_at.toISOString()
            : String(row.runtime_requested_at),
          startedAt: row.runtime_started_at
            ? row.runtime_started_at instanceof Date
              ? row.runtime_started_at.toISOString()
              : String(row.runtime_started_at)
            : null,
          completedAt: row.runtime_completed_at
            ? row.runtime_completed_at instanceof Date
              ? row.runtime_completed_at.toISOString()
              : String(row.runtime_completed_at)
            : null,
          workflowRunId: row.runtime_workflow_run_id == null
            ? null
            : Number(row.runtime_workflow_run_id),
        }
      : null,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}

export async function listWorkspaceInvestigations(
  orgId: string,
): Promise<InvestigationWorkspaceItem[]> {
  if (workspacePersistenceMode(orgId) === "memory") {
    return [
      {
        id: seedRecommendation.id,
        problemId: seedProblem.id,
        problemTitle: seedProblem.title,
        title: `${seedProblem.productArea} investigation`,
        status: "Ready for review",
        confidence: seedRecommendation.confidence,
        signalConfidence: seedProblem.confidence,
        relatedSignalCount: seedProblem.feedbackIds.length,
        severity: seedProblem.severity,
        stage: seedProblem.stage,
        productArea: seedProblem.productArea,
        team: seedProblem.team,
        repository: seedProblem.suspectedRepository,
        hypothesis: seedRecommendation.hypothesis,
        assumptions: seedRecommendation.assumptions,
        missingInformation: seedRecommendation.missingInformation,
        proposedAction: seedRecommendation.proposedAction,
        recommendedTests: seedRecommendation.tests,
        suspectedFiles: seedProblem.suspectedFiles,
        verification: {
          status: "Confirmed current",
          method: "Product reproduction",
          summary: "The demonstration issue is pre-verified so the sample workflow can show prompt preparation.",
          actorName: "CloseSpan demo",
          verifiedAt: "2026-08-08T00:00:00.000Z",
        },
        runtimeVerification: null,
        updatedAt: "2026-08-08T00:00:00.000Z",
      },
    ];
  }

  const result = await databasePool().query<InvestigationRow>(
    `SELECT investigation.id,
            investigation.problem_id,
            problem.title AS problem_title,
            investigation.title,
            investigation.status,
            investigation.confidence,
            problem.confidence AS signal_confidence,
            (
              SELECT count(*)::int
                FROM feedback_cluster_memberships membership
               WHERE membership.org_id=investigation.org_id
                 AND membership.problem_id=investigation.problem_id
            ) AS related_signal_count,
            problem.severity,
            problem.stage,
            problem.product_area,
            problem.team,
            problem.suspected_repository AS repository,
            investigation.hypothesis,
            investigation.assumptions,
            investigation.missing_information,
            investigation.proposed_action,
            investigation.recommended_tests,
            investigation.suspected_files,
            investigation.verification_status,
            investigation.verification_method,
            investigation.verification_summary,
            investigation.verification_actor_name,
            investigation.verified_at,
            runtime.id AS runtime_run_id,
            runtime.status AS runtime_status,
            runtime.outcome AS runtime_outcome,
            runtime.repository AS runtime_repository,
            runtime.base_sha AS runtime_base_sha,
            runtime.summary AS runtime_summary,
            runtime.failure_message AS runtime_failure_message,
            runtime.requested_by_name AS runtime_requested_by_name,
            runtime.requested_at AS runtime_requested_at,
            runtime.started_at AS runtime_started_at,
            runtime.completed_at AS runtime_completed_at,
            runtime.workflow_run_id AS runtime_workflow_run_id,
            investigation.updated_at
       FROM investigations investigation
      JOIN product_problems problem
         ON problem.org_id=investigation.org_id
        AND problem.id=investigation.problem_id
       LEFT JOIN LATERAL (
         SELECT candidate.*
           FROM issue_runtime_verification_runs candidate
          WHERE candidate.org_id=investigation.org_id
            AND candidate.problem_id=investigation.problem_id
          ORDER BY candidate.requested_at DESC,candidate.id
          LIMIT 1
       ) runtime ON true
      WHERE investigation.org_id=$1
      ORDER BY
        CASE investigation.status
          WHEN 'Ready for review' THEN 1
          WHEN 'Ready for approval' THEN 1
          WHEN 'Gathering evidence' THEN 2
          WHEN 'Running' THEN 2
          WHEN 'Monitoring' THEN 3
          ELSE 4
        END,
        investigation.updated_at DESC,
        investigation.id`,
    [orgId],
  );

  return result.rows
    .filter((row) => isCustomerVisibleInvestigationTitle(row.title))
    .map(mapInvestigationWorkspaceRow);
}

export async function recordInvestigationVerification(input: {
  orgId: string;
  problemId: string;
  status: InvestigationVerificationStatus;
  method: InvestigationVerificationMethod;
  summary: string;
  actor: { actorId: string; actorName: string; traceId: string };
}): Promise<void> {
  if (workspacePersistenceMode(input.orgId) === "memory") {
    throw new HttpError(409, "Verification changes are unavailable in the demonstration workspace");
  }
  if (!VERIFICATION_STATUSES.has(input.status)) {
    throw new HttpError(400, "Choose a valid verification outcome");
  }
  if (!VERIFICATION_METHODS.has(input.method)) {
    throw new HttpError(400, "Choose how the issue was checked");
  }
  const summary = input.summary.trim().replace(/\s+/g, " ");
  if (summary.length < 20 || summary.length > 2_000) {
    throw new HttpError(400, "Verification evidence must be between 20 and 2,000 characters");
  }
  await transaction(async (client) => {
    const updated = await client.query<{ id: string }>(
      `UPDATE investigations investigation
          SET verification_status=$3,verification_method=$4,verification_summary=$5,
              verification_actor_id=$6,verification_actor_name=$7,verified_at=now(),updated_at=now()
        WHERE investigation.org_id=$1
          AND investigation.id=(
            SELECT latest.id FROM investigations latest
             WHERE latest.org_id=$1 AND latest.problem_id=$2
             ORDER BY latest.updated_at DESC,latest.id LIMIT 1
          )
        RETURNING investigation.id`,
      [input.orgId, input.problemId, input.status, input.method, summary,
        input.actor.actorId, input.actor.actorName],
    );
    const investigationId = updated.rows[0]?.id;
    if (!investigationId) throw new HttpError(404, "Investigation was not found");
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,$5,'Investigation',$6,$7)`,
      [randomUUID(), input.orgId, input.actor.actorId, input.actor.actorName,
        `Recorded issue verification: ${input.status} via ${input.method}.`, investigationId,
        input.actor.traceId],
    );
    await client.query(
      "UPDATE workspaces SET version=version+1,updated_at=now() WHERE org_id=$1",
      [input.orgId],
    );
  });
}
