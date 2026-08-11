import { databasePool } from "./db";
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
