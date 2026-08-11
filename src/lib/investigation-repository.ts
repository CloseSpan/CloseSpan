import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import type { Severity, Stage } from "./domain";
import {
  primaryProblem as seedProblem,
  recommendation as seedRecommendation,
} from "./seed";
import { workspacePersistenceMode } from "./workspace-persistence";

export interface InvestigationWorkspaceItem {
  id: string;
  problemId: string;
  problemTitle: string;
  title: string;
  status: string;
  confidence: number;
  signalConfidence: number;
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
  updatedAt: string;
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
  updated_at: Date | string;
}

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
            investigation.updated_at
       FROM investigations investigation
       JOIN product_problems problem
         ON problem.org_id=investigation.org_id
        AND problem.id=investigation.problem_id
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
