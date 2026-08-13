import { databasePool } from "./db";
import type {
  EngineeringTicketSpecification,
  PromptEvidence,
} from "./engineering-prompt";
import {
  issueRuntimeVerificationReportSchema,
  type IssueRuntimeVerificationOutcome,
  type IssueRuntimeVerificationReport,
} from "./issue-runtime-verification";
import { getActiveConfirmedProblemRepositoryMatch } from "./problem-repository-match-repository";
import {
  CLOSESPAN_SYSTEM_PATH_PREFIXES,
  listRepositoryContexts,
  searchRepositoryContext,
  type RepositoryContextSearchResult,
} from "./repository-context-repository";
import { workspacePersistenceMode } from "./workspace-persistence";

export interface RepositoryEvidenceMatch {
  path: string;
  startLine: number;
  endLine: number;
  declarations: string[];
  score: number;
}

export interface ProductProblemEvidenceBundle {
  repository: string;
  commitSha: string;
  capturedAt: string;
  freshness: "Runtime commit" | "Indexed snapshot";
  matches: RepositoryEvidenceMatch[];
  relevantCodePaths: string[];
  remainingEvidence: string[];
  recommendedChecks: string[];
  runtimeVerification: PromptEvidence["runtimeVerification"] | null;
  contextStatus: "Exact commit" | "Indexing required" | "Refresh required";
  contextMessage: string;
}

interface ProblemEvidenceRow {
  title: string;
  statement: string;
  summary: string;
  hypothesis: string;
  assumptions: unknown;
  missing_information: unknown;
  proposed_action: string;
  recommended_tests: unknown;
  suspected_files: unknown;
  verification_status: string;
  verification_method: string | null;
  verification_summary: string | null;
  related_signal_count: number;
  runtime_repository: string | null;
  runtime_base_sha: string | null;
  runtime_outcome: IssueRuntimeVerificationOutcome | null;
  runtime_report: unknown;
  runtime_completed_at: Date | string | null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function pathReference(match: RepositoryEvidenceMatch): string {
  return match.startLine === match.endLine
    ? `${match.path}:${match.startLine}`
    : `${match.path}:${match.startLine}-${match.endLine}`;
}

function testPath(path: string): boolean {
  return /(^|\/)(?:tests?|specs?|__tests__|[^/]+tests|[^/]+specs)(\/|$)|(?:^|\/)[^/]+\.(?:test|spec)\.[^.]+$/i.test(path);
}

function productSourcePath(path: string): boolean {
  return !/^\.github\/workflows\/closespan-/i.test(path)
    && !/^\.closespan(?:-run)?\//i.test(path);
}

function runtimeEvidence(
  report: IssueRuntimeVerificationReport | null,
  row: ProblemEvidenceRow,
): PromptEvidence["runtimeVerification"] | undefined {
  if (!report || !row.runtime_outcome || !row.runtime_repository || !row.runtime_completed_at) {
    return undefined;
  }
  return {
    outcome: row.runtime_outcome,
    summary: report.summary,
    expectedBehavior: report.expectedBehavior,
    actualBehavior: report.actualBehavior,
    reproductionSteps: report.reproductionSteps,
    commands: report.commands,
    observations: report.observations,
    artifacts: report.artifacts,
    repository: row.runtime_repository,
    commitSha: report.baseSha,
    completedAt: row.runtime_completed_at instanceof Date
      ? row.runtime_completed_at.toISOString()
      : new Date(row.runtime_completed_at).toISOString(),
    runnerLabel: report.environment.runnerLabel,
    workflowRunId: report.environment.workflowRunId,
  };
}

function remainingEvidence(input: {
  gaps: string[];
  relatedSignalCount: number;
  report: IssueRuntimeVerificationReport | null;
  verificationStatus: string;
  verificationMethod: string | null;
  verificationSummary: string | null;
}): string[] {
  const gaps = input.gaps.filter((gap) => {
    const normalized = gap.toLowerCase();
    if (
      (input.report?.reproductionSteps.length
        || (input.verificationMethod === "Product reproduction" && input.verificationSummary))
      && /reproduction|expected result/.test(normalized)
    ) {
      return false;
    }
    if (
      input.report
      && (input.report.commands.length || input.report.observations.length)
      && /trace|console error|request identifier|runtime output/.test(normalized)
    ) {
      return false;
    }
    if (input.relatedSignalCount > 1 && /second independent|another customer report/.test(normalized)) {
      return false;
    }
    return true;
  });
  return input.verificationStatus === "Verification blocked"
    ? unique([
        "Resolve the current runtime verification blocker, then rerun the same scenario to compare expected and actual behavior.",
        ...gaps,
      ])
    : gaps;
}

export function buildProblemRepositoryContextQuery(input: {
  title: string;
  statement: string;
  summary: string;
  hypothesis: string;
  proposedAction: string;
  missingInformation: string[];
  suspectedFiles: string[];
}): string {
  return [
    `Investigate the reported product problem: ${input.title}.`,
    `Reported behavior: ${input.statement}`,
    `Problem summary: ${input.summary}`,
    `Working hypothesis: ${input.hypothesis}`,
    `Proposed investigation action: ${input.proposedAction}`,
    input.missingInformation.length
      ? `Open evidence gaps: ${input.missingInformation.join("; ")}`
      : "",
    input.suspectedFiles.length
      ? `Previously suspected paths: ${input.suspectedFiles.join(", ")}`
      : "",
    "Return the implementation path, definitions and references, data flow, nearest tests, configuration or feature flags, and source evidence that can confirm or reject the hypothesis. Cite exact source locations and identify unsupported assumptions. Repository matches are leads, not proof of root cause.",
  ].filter(Boolean).join("\n");
}

function contextPromptEvidence(input: {
  repository: string;
  query: string;
  context: RepositoryContextSearchResult;
  capturedAt: string;
}): PromptEvidence["repositoryContext"] {
  return {
    provider: "CloseSpan Repository Context",
    repository: input.repository,
    commitSha: input.context.commitSha,
    query: input.query,
    retrieval: input.context.retrieval,
    matches: input.context.matches,
    capturedAt: input.capturedAt,
  };
}

async function readProblemEvidenceRow(
  orgId: string,
  problemId: string,
): Promise<ProblemEvidenceRow | null> {
  const result = await databasePool().query<ProblemEvidenceRow>(
    `SELECT problem.title,problem.statement,problem.summary,
            investigation.hypothesis,investigation.assumptions,
            investigation.missing_information,investigation.proposed_action,
            investigation.recommended_tests,investigation.suspected_files,
            investigation.verification_status,investigation.verification_method,
            investigation.verification_summary,
            (SELECT count(*)::int FROM feedback_cluster_memberships membership
              WHERE membership.org_id=problem.org_id
                AND membership.problem_id=problem.id) AS related_signal_count,
            runtime.repository AS runtime_repository,
            runtime.base_sha AS runtime_base_sha,
            runtime.outcome AS runtime_outcome,
            runtime.report AS runtime_report,
            runtime.completed_at AS runtime_completed_at
       FROM product_problems problem
       JOIN LATERAL (
         SELECT candidate.* FROM investigations candidate
          WHERE candidate.org_id=problem.org_id AND candidate.problem_id=problem.id
          ORDER BY candidate.updated_at DESC,candidate.id LIMIT 1
       ) investigation ON true
       LEFT JOIN LATERAL (
         SELECT candidate.* FROM issue_runtime_verification_runs candidate
          WHERE candidate.org_id=problem.org_id AND candidate.problem_id=problem.id
          ORDER BY candidate.requested_at DESC,candidate.id LIMIT 1
       ) runtime ON true
      WHERE problem.org_id=$1 AND problem.id=$2`,
    [orgId, problemId],
  );
  return result.rows[0] ?? null;
}

function parseRuntimeReport(row: ProblemEvidenceRow): IssueRuntimeVerificationReport | null {
  const parsed = issueRuntimeVerificationReportSchema.safeParse(row.runtime_report);
  return parsed.success ? parsed.data : null;
}

export async function getProductProblemEvidenceBundle(
  orgId: string,
  problemId: string,
): Promise<ProductProblemEvidenceBundle | null> {
  if (workspacePersistenceMode(orgId) !== "postgres") return null;
  const row = await readProblemEvidenceRow(orgId, problemId);
  if (!row) return null;
  const report = parseRuntimeReport(row);
  const match = await getActiveConfirmedProblemRepositoryMatch(orgId, problemId);
  const repository = row.runtime_repository ?? match?.repository;
  if (!repository) return null;
  const contexts = await listRepositoryContexts(orgId);
  const indexed = contexts.find((candidate) => candidate.repository === repository);
  const commitSha = row.runtime_base_sha ?? indexed?.commitSha ?? "";
  const freshness: ProductProblemEvidenceBundle["freshness"] = row.runtime_base_sha
    ? "Runtime commit"
    : "Indexed snapshot";
  const query = buildProblemRepositoryContextQuery({
    title: row.title,
    statement: row.statement,
    summary: row.summary,
    hypothesis: row.hypothesis,
    proposedAction: row.proposed_action,
    missingInformation: stringArray(row.missing_information),
    suspectedFiles: stringArray(row.suspected_files),
  });
  const capturedAt = new Date().toISOString();
  const base = {
    repository,
    commitSha,
    capturedAt,
    freshness,
    remainingEvidence: remainingEvidence({
      gaps: stringArray(row.missing_information),
      relatedSignalCount: Number(row.related_signal_count),
      report,
      verificationStatus: row.verification_status,
      verificationMethod: row.verification_method,
      verificationSummary: row.verification_summary,
    }),
    runtimeVerification: runtimeEvidence(report, row) ?? null,
  };
  if (!commitSha) {
    return {
      ...base,
      matches: [],
      relevantCodePaths: [],
      recommendedChecks: stringArray(row.recommended_tests),
      contextStatus: "Indexing required",
      contextMessage: "Repository context has not been created yet. Index this repository before generating a prompt.",
    };
  }
  try {
    const context = await searchRepositoryContext({
      orgId,
      repository,
      expectedCommitSha: commitSha,
      query,
      maxOutputLength: 32_000,
      excludePathPrefixes: CLOSESPAN_SYSTEM_PATH_PREFIXES,
    });
    const matches = context.matches.filter((item) => productSourcePath(item.path)).slice(0, 5);
    const nearestTests = matches.filter((item) => testPath(item.path)).slice(0, 2);
    const sourceMatches = matches.filter((item) => !testPath(item.path)).slice(0, 2);
    const contextualChecks = [
      ...nearestTests.map((item) => `Run or extend the nearest existing test at ${pathReference(item)}.`),
      ...sourceMatches.map((item) => `Trace the reported behavior through ${pathReference(item)} and confirm the runtime branch before changing it.`),
    ];
    return {
      ...base,
      commitSha: context.commitSha,
      matches,
      relevantCodePaths: matches.map(pathReference),
      recommendedChecks: unique([
        ...contextualChecks,
        ...stringArray(row.recommended_tests),
      ]).slice(0, 6),
      contextStatus: "Exact commit",
      contextMessage: `${matches.length} source ${matches.length === 1 ? "match" : "matches"} from the pinned repository snapshot. Matches are investigation leads, not confirmed root cause.`,
    };
  } catch {
    return {
      ...base,
      matches: [],
      relevantCodePaths: [],
      recommendedChecks: stringArray(row.recommended_tests),
      contextStatus: "Refresh required",
      contextMessage: `The repository changed after its context was indexed. Refresh context to analyze ${commitSha.slice(0, 12)} before generating a prompt.`,
    };
  }
}

export async function enrichPromptEvidence(input: {
  orgId: string;
  problemId: string;
  ticket: EngineeringTicketSpecification;
  evidence: PromptEvidence;
}): Promise<PromptEvidence> {
  if (workspacePersistenceMode(input.orgId) !== "postgres") return input.evidence;
  const row = await readProblemEvidenceRow(input.orgId, input.problemId);
  if (!row) return input.evidence;
  const query = buildProblemRepositoryContextQuery({
    title: row.title,
    statement: row.statement,
    summary: row.summary,
    hypothesis: row.hypothesis,
    proposedAction: row.proposed_action,
    missingInformation: stringArray(row.missing_information),
    suspectedFiles: stringArray(row.suspected_files),
  });
  const context = await searchRepositoryContext({
    orgId: input.orgId,
    repository: input.ticket.repository,
    expectedCommitSha: input.ticket.baseSha,
    query,
    maxOutputLength: 20_000,
    excludePathPrefixes: CLOSESPAN_SYSTEM_PATH_PREFIXES,
  });
  const report = parseRuntimeReport(row);
  return {
    ...input.evidence,
    suspectedFiles: unique([
      ...context.matches.slice(0, 8).map((item) => item.path),
      ...input.evidence.suspectedFiles,
    ]),
    repositoryContext: contextPromptEvidence({
      repository: input.ticket.repository,
      query,
      context,
      capturedAt: new Date().toISOString(),
    }),
    runtimeVerification: report?.baseSha === input.ticket.baseSha.toLowerCase()
      ? runtimeEvidence(report, row)
      : undefined,
  };
}
