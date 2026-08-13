import { randomUUID } from "node:crypto";
import { databasePool, transaction } from "./db";
import {
  getExecutionProfileVersion,
  saveProblemRepositoryMatch,
} from "./execution-profile-repository";
import {
  assertExecutionProfileNarrowing,
  type ExecutionProfileSnapshot,
  type ProblemRepositoryMatchView,
} from "./execution-profile";
import {
  isUnresolvedRepositoryLabel,
  resolveProblemRepository,
  type ProblemRepositoryResolution,
  type RepositoryMatchCandidate,
} from "./problem-repository-match";
import { requirePostgresWorkspace } from "./workspace-persistence";

interface ProblemMatchRow {
  id: string;
  title: string;
  statement: string;
  summary: string;
  product_area: string;
  team: string;
  suspected_repository: string;
  suspected_files: string[];
}

interface RepositoryProfileRow {
  repository: string;
  default_branch: string;
  profile_id: string | null;
  workspace_root: string | null;
  profile_active: boolean;
  config: unknown;
  detection_evidence: unknown;
}

interface ProblemMatchViewRow {
  problem_id: string;
  repository: string;
  workspace_root: string;
  profile_id: string;
  profile_hash: string;
  confidence: number;
  reasons: unknown;
  status: ProblemRepositoryMatchView["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

export class ProblemRepositoryMatchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ProblemRepositoryMatchActor {
  actorId: string;
  actorName: string;
  traceId: string;
}

export interface ConfirmProblemRepositoryMatchResult {
  match: ProblemRepositoryMatchView;
  problemFiles: string[];
  engineeringSpecificationUpdated: boolean;
  engineeringUpdateReason: string | null;
}

export interface ProblemRepositoryMatchRefreshResult {
  problemId: string;
  resolution: ProblemRepositoryResolution;
  persistedProfileId: string | null;
  profileDetectionRequired: boolean;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return objectValue(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") {
    try {
      return stringArray(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function matchFromRow(row: ProblemMatchViewRow): ProblemRepositoryMatchView {
  return {
    problemId: row.problem_id,
    repository: row.repository,
    workspaceRoot: row.workspace_root,
    profileId: row.profile_id,
    profileHash: row.profile_hash,
    confidence: Number(row.confidence),
    reasons: stringArray(row.reasons),
    status: row.status,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  };
}

function safeRelativePath(value: string): string | null {
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    return null;
  }
  return normalized
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/") || null;
}

function filesForConfirmedScope(input: {
  previousRepository: string;
  repository: string;
  workspaceRoot: string;
  suspectedFiles: string[];
}): string[] {
  if (
    !isUnresolvedRepositoryLabel(input.previousRepository) &&
    input.previousRepository.trim().toLowerCase() !== input.repository.toLowerCase()
  ) {
    return [];
  }
  const root = input.workspaceRoot === "."
    ? null
    : `${input.workspaceRoot.replace(/\/$/, "")}/`;
  return [...new Set(input.suspectedFiles.flatMap((value) => {
    const path = safeRelativePath(value);
    if (!path || (root && path !== input.workspaceRoot && !path.startsWith(root))) {
      return [];
    }
    return [path];
  }))].slice(0, 100);
}

function validSha(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

export async function requireProblemRepositoryMatchProblem(
  orgId: string,
  problemId: string,
): Promise<void> {
  requirePostgresWorkspace(orgId, "Problem repository matching");
  const result = await databasePool().query(
    "SELECT 1 FROM product_problems WHERE org_id=$1 AND id=$2",
    [orgId, problemId],
  );
  if (!result.rowCount) {
    throw new ProblemRepositoryMatchError("Product problem was not found", 404);
  }
}

function repositoryCandidates(rows: RepositoryProfileRow[]): RepositoryMatchCandidate[] {
  const grouped = new Map<string, RepositoryMatchCandidate>();
  for (const row of rows) {
    const existing = grouped.get(row.repository) ?? {
      repository: row.repository,
      defaultBranch: row.default_branch,
      workspaceRoots: [],
      manifestSignals: [],
    };
    if (row.workspace_root && !existing.workspaceRoots?.includes(row.workspace_root)) {
      existing.workspaceRoots?.push(row.workspace_root);
    }
    const config = objectValue(row.config);
    const evidence = objectValue(row.detection_evidence);
    const signals = [
      ...stringArray(evidence.manifestPaths),
      ...stringArray(evidence.manifest_paths),
      typeof config.language === "string" ? config.language : "",
      typeof config.framework === "string" ? config.framework : "",
      typeof config.packageManager === "string" ? config.packageManager : "",
    ].filter(Boolean);
    for (const signal of signals) {
      if (!existing.manifestSignals?.includes(signal)) existing.manifestSignals?.push(signal);
    }
    grouped.set(row.repository, existing);
  }
  return [...grouped.values()];
}

function matchingRootScore(root: string, suspectedFiles: string[]): number {
  if (root === ".") return 0;
  const prefix = `${root.replace(/\/$/, "")}/`;
  return suspectedFiles.some((path) => path === root || path.startsWith(prefix))
    ? root.split("/").length
    : 0;
}

function selectProfile(
  repository: string,
  rows: RepositoryProfileRow[],
  suspectedFiles: string[],
): RepositoryProfileRow | null {
  return rows
    .filter((row) => row.repository === repository && row.profile_id)
    .sort((left, right) => {
      const rootDifference = matchingRootScore(
        right.workspace_root ?? ".",
        suspectedFiles,
      ) - matchingRootScore(left.workspace_root ?? ".", suspectedFiles);
      if (rootDifference) return rootDifference;
      if (left.profile_active !== right.profile_active) return left.profile_active ? -1 : 1;
      return (left.workspace_root ?? ".").localeCompare(right.workspace_root ?? ".");
    })[0] ?? null;
}

/**
 * Refreshes a problem's reviewable repository match from the workspace's
 * currently authorized repositories and active/detected execution profiles.
 * This never activates a detected profile and never grants repository access.
 */
export async function refreshProblemRepositoryMatch(
  orgId: string,
  problemId: string,
): Promise<ProblemRepositoryMatchRefreshResult> {
  requirePostgresWorkspace(orgId, "Problem repository detection");
  const problemResult = await databasePool().query<ProblemMatchRow>(
    `SELECT id,title,statement,summary,product_area,team,
            suspected_repository,suspected_files
       FROM product_problems
      WHERE org_id=$1 AND id=$2`,
    [orgId, problemId],
  );
  const problem = problemResult.rows[0];
  if (!problem) {
    throw new ProblemRepositoryMatchError("Product problem was not found", 404);
  }

  const profileResult = await databasePool().query<RepositoryProfileRow>(
    `SELECT allowlist.repository,allowlist.default_branch,
            profile.id AS profile_id,assignment.workspace_root,
            (assignment.active_profile_id=profile.id) AS profile_active,
            profile.config,profile.detection_evidence
       FROM github_repository_allowlists allowlist
       LEFT JOIN execution_profile_assignments assignment
         ON assignment.org_id=allowlist.org_id
        AND assignment.repository=allowlist.repository
       LEFT JOIN execution_profile_versions profile
         ON profile.org_id=assignment.org_id
        AND profile.id=COALESCE(
          assignment.active_profile_id,
          assignment.detected_profile_id
        )
      WHERE allowlist.org_id=$1 AND allowlist.active=true
      ORDER BY allowlist.repository,assignment.workspace_root`,
    [orgId],
  );
  const rows = profileResult.rows;
  const resolution = resolveProblemRepository(
    {
      suspectedRepository: problem.suspected_repository,
      suspectedFiles: problem.suspected_files ?? [],
      title: problem.title,
      statement: problem.statement,
      summary: problem.summary,
      productArea: problem.product_area,
      team: problem.team,
    },
    repositoryCandidates(rows),
  );

  const selectedProfile = resolution.selected
    ? selectProfile(
        resolution.selected.repository,
        rows,
        problem.suspected_files ?? [],
      )
    : null;
  if (resolution.selected && selectedProfile?.profile_id) {
    await saveProblemRepositoryMatch({
      orgId,
      problemId,
      profileId: selectedProfile.profile_id,
      confidence: resolution.selected.confidence,
      reasons: resolution.selected.reasons,
      status: "Suggested",
    });
  }

  return {
    problemId,
    resolution,
    persistedProfileId: selectedProfile?.profile_id ?? null,
    profileDetectionRequired: Boolean(resolution.selected && !selectedProfile?.profile_id),
  };
}

/**
 * Returns a confirmed match only while the exact immutable profile is still
 * the active assignment for its authorized repository/root. A newer active
 * version therefore requires another explicit ticket review.
 */
export async function getActiveConfirmedProblemRepositoryMatch(
  orgId: string,
  problemId: string,
): Promise<ProblemRepositoryMatchView | null> {
  requirePostgresWorkspace(orgId, "Problem repository matching");
  const result = await databasePool().query<ProblemMatchViewRow>(
    `SELECT match.problem_id,match.repository,match.workspace_root,
            match.profile_id,match.profile_hash,match.confidence,match.reasons,
            match.status,match.created_at,match.updated_at
       FROM problem_repository_matches match
       JOIN github_repository_allowlists allowlist
         ON allowlist.org_id=match.org_id
        AND allowlist.repository=match.repository
        AND allowlist.active=true
       JOIN execution_profile_assignments assignment
         ON assignment.org_id=match.org_id
        AND assignment.repository=match.repository
        AND assignment.workspace_root=match.workspace_root
        AND assignment.active_profile_id=match.profile_id
        AND assignment.active_profile_hash=match.profile_hash
       JOIN execution_profile_versions profile
         ON profile.org_id=match.org_id
        AND profile.id=match.profile_id
        AND profile.content_hash=match.profile_hash
        AND profile.source IN ('confirmed','override')
      WHERE match.org_id=$1 AND match.problem_id=$2
        AND match.status='Confirmed'
      ORDER BY match.updated_at DESC,match.repository,match.workspace_root
      LIMIT 1`,
    [orgId, problemId],
  );
  return result.rows[0] ? matchFromRow(result.rows[0]) : null;
}

export async function confirmProblemRepositoryMatch(input: {
  orgId: string;
  problemId: string;
  profileId: string;
  repository?: string;
  workspaceRoot?: string;
  actor: ProblemRepositoryMatchActor;
}): Promise<ConfirmProblemRepositoryMatchResult> {
  requirePostgresWorkspace(input.orgId, "Problem repository confirmation");
  const profile = await getExecutionProfileVersion(input.orgId, input.profileId);
  if (
    !profile ||
    !profile.repository ||
    !["confirmed", "override"].includes(profile.source)
  ) {
    throw new ProblemRepositoryMatchError(
      "Select an active confirmed execution profile before confirming the repository",
      409,
    );
  }
  if (
    (input.repository !== undefined && profile.repository !== input.repository) ||
    (input.workspaceRoot !== undefined && profile.workspaceRoot !== input.workspaceRoot)
  ) {
    throw new ProblemRepositoryMatchError(
      "The selected execution profile no longer matches this repository root",
      409,
    );
  }
  const snapshot: ExecutionProfileSnapshot = {
    profileId: profile.id,
    repository: profile.repository,
    workspaceRoot: profile.workspaceRoot,
    version: profile.version,
    source: profile.source,
    contentHash: profile.contentHash,
    config: profile.config,
  };

  return transaction(async (client) => {
    const problemResult = await client.query<{
      suspected_repository: string;
      suspected_files: unknown;
    }>(
      `SELECT suspected_repository,suspected_files
         FROM product_problems
        WHERE org_id=$1 AND id=$2
        FOR UPDATE`,
      [input.orgId, input.problemId],
    );
    const problem = problemResult.rows[0];
    if (!problem) {
      throw new ProblemRepositoryMatchError("Product problem was not found", 404);
    }

    const assignmentResult = await client.query<{
      default_branch: string;
      active_profile_id: string | null;
      active_profile_hash: string | null;
    }>(
      `SELECT allowlist.default_branch,assignment.active_profile_id,
              assignment.active_profile_hash
         FROM github_repository_allowlists allowlist
         JOIN execution_profile_assignments assignment
           ON assignment.org_id=allowlist.org_id
          AND assignment.repository=allowlist.repository
          AND assignment.workspace_root=$3
        WHERE allowlist.org_id=$1 AND allowlist.repository=$2
          AND allowlist.active=true
        FOR UPDATE OF assignment`,
      [input.orgId, profile.repository, profile.workspaceRoot],
    );
    const assignment = assignmentResult.rows[0];
    if (
      !assignment ||
      assignment.active_profile_id !== profile.id ||
      assignment.active_profile_hash !== profile.contentHash
    ) {
      throw new ProblemRepositoryMatchError(
        "The selected profile is not active. Confirm it in execution profile settings first",
        409,
      );
    }

    const existingResult = await client.query<{
      confidence: number;
      reasons: unknown;
    }>(
      `SELECT confidence,reasons
         FROM problem_repository_matches
        WHERE org_id=$1 AND problem_id=$2 AND repository=$3 AND workspace_root=$4
        FOR UPDATE`,
      [input.orgId, input.problemId, profile.repository, profile.workspaceRoot],
    );
    const existing = existingResult.rows[0];
    const confidence = existing ? Number(existing.confidence) : 1;
    const reasons = existing && stringArray(existing.reasons).length
      ? stringArray(existing.reasons)
      : ["A product manager selected this authorized repository and active profile."];

    await client.query(
      `UPDATE problem_repository_matches
          SET status='Rejected',updated_at=now()
        WHERE org_id=$1 AND problem_id=$2
          AND NOT (repository=$3 AND workspace_root=$4)`,
      [input.orgId, input.problemId, profile.repository, profile.workspaceRoot],
    );
    const confirmed = await client.query<ProblemMatchViewRow>(
      `INSERT INTO problem_repository_matches(
         org_id,problem_id,repository,workspace_root,profile_id,profile_hash,
         confidence,reasons,status
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Confirmed')
       ON CONFLICT(org_id,problem_id,repository,workspace_root) DO UPDATE SET
         profile_id=excluded.profile_id,profile_hash=excluded.profile_hash,
         confidence=excluded.confidence,reasons=excluded.reasons,
         status='Confirmed',updated_at=now()
       RETURNING problem_id,repository,workspace_root,profile_id,profile_hash,
                 confidence,reasons,status,created_at,updated_at`,
      [
        input.orgId,
        input.problemId,
        profile.repository,
        profile.workspaceRoot,
        profile.id,
        profile.contentHash,
        confidence,
        JSON.stringify(reasons),
      ],
    );
    const matchRow = confirmed.rows[0];
    if (!matchRow) {
      throw new ProblemRepositoryMatchError("Repository match was not confirmed", 409);
    }

    const problemFiles = filesForConfirmedScope({
      previousRepository: problem.suspected_repository,
      repository: profile.repository,
      workspaceRoot: profile.workspaceRoot,
      suspectedFiles: stringArray(problem.suspected_files),
    });
    await client.query(
      `UPDATE product_problems
          SET suspected_repository=$3,suspected_files=$4,updated_at=now()
        WHERE org_id=$1 AND id=$2`,
      [input.orgId, input.problemId, profile.repository, JSON.stringify(problemFiles)],
    );

    let engineeringSpecificationUpdated = false;
    let engineeringUpdateReason: string | null = null;
    const specificationResult = await client.query<{
      id: string;
      implementation_state: string;
      repository: string;
      base_branch: string;
      base_sha: string;
      permitted_paths: unknown;
      required_commands: unknown;
      execution_profile_id: string | null;
      execution_profile_hash: string | null;
      has_prompt: boolean;
    }>(
      `SELECT specification.id,specification.implementation_state,
              specification.repository,specification.base_branch,
              specification.base_sha,specification.permitted_paths,
              specification.required_commands,specification.execution_profile_id,
              specification.execution_profile_hash,
              EXISTS(
                SELECT 1 FROM implementation_prompts prompt
                 WHERE prompt.org_id=specification.org_id
                   AND prompt.problem_id=specification.problem_id
                   AND prompt.status <> 'Superseded'
              ) AS has_prompt
         FROM engineering_ticket_specifications specification
        WHERE specification.org_id=$1 AND specification.problem_id=$2
        FOR UPDATE`,
      [input.orgId, input.problemId],
    );
    const specification = specificationResult.rows[0];
    if (!specification) {
      engineeringUpdateReason =
        "No engineering specification exists yet; the confirmed context will be used when one is created.";
    } else if (specification.has_prompt) {
      engineeringUpdateReason =
        "The existing implementation prompt is immutable, so its repository context was not changed.";
    } else if (specification.implementation_state !== "Draft specification") {
      engineeringUpdateReason =
        "The engineering ticket is already in progress, so its repository context was not changed.";
    } else if (
      specification.execution_profile_id &&
      (
        specification.execution_profile_id !== profile.id ||
        specification.execution_profile_hash !== profile.contentHash
      )
    ) {
      engineeringUpdateReason =
        "The engineering ticket has an explicit execution profile override, so its repository context was not changed automatically.";
    } else {
      const evidence = objectValue(profile.detectionEvidence);
      const evidenceBranch = typeof evidence.defaultBranch === "string"
        ? evidence.defaultBranch
        : null;
      const detectedSha = evidenceBranch === assignment.default_branch
        ? validSha(evidence.sourceSha)
        : null;
      const existingSha =
        specification.repository === profile.repository &&
        specification.base_branch === assignment.default_branch
          ? validSha(specification.base_sha)
          : null;
      const baseSha = detectedSha ?? existingSha;
      if (!baseSha) {
        engineeringUpdateReason =
          "No reviewed commit SHA is available. Refresh repository detection before updating the ticket.";
      } else {
        try {
          assertExecutionProfileNarrowing(snapshot, {
            permittedPaths: stringArray(specification.permitted_paths),
            requiredCommands: stringArray(specification.required_commands),
          });
          await client.query(
            `UPDATE engineering_ticket_specifications
                SET repository=$3,base_branch=$4,base_sha=$5,
                    updated_by=$6,updated_at=now()
              WHERE org_id=$1 AND problem_id=$2`,
            [
              input.orgId,
              input.problemId,
              profile.repository,
              assignment.default_branch,
              baseSha,
              input.actor.actorId,
            ],
          );
          engineeringSpecificationUpdated = true;
        } catch (error) {
          engineeringUpdateReason = error instanceof Error
            ? `The ticket remains unchanged: ${error.message}`
            : "The ticket paths or commands exceed the selected execution profile.";
        }
      }
    }

    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,$5,'ProblemRepositoryMatch',$6,$7)`,
      [
        randomUUID(),
        input.orgId,
        input.actor.actorId,
        input.actor.actorName,
        `Confirmed ${profile.repository} at ${profile.workspaceRoot} with immutable execution profile ${profile.id}`,
        input.problemId,
        `${input.actor.traceId}_${randomUUID()}`,
      ],
    );

    return {
      match: matchFromRow(matchRow),
      problemFiles,
      engineeringSpecificationUpdated,
      engineeringUpdateReason,
    };
  });
}

export async function rejectProblemRepositoryMatch(input: {
  orgId: string;
  problemId: string;
  profileId: string;
  actor: ProblemRepositoryMatchActor;
}): Promise<ProblemRepositoryMatchView> {
  requirePostgresWorkspace(input.orgId, "Problem repository review");
  return transaction(async (client) => {
    const problem = await client.query(
      "SELECT 1 FROM product_problems WHERE org_id=$1 AND id=$2 FOR UPDATE",
      [input.orgId, input.problemId],
    );
    if (!problem.rowCount) {
      throw new ProblemRepositoryMatchError("Product problem was not found", 404);
    }
    const result = await client.query<ProblemMatchViewRow>(
      `UPDATE problem_repository_matches
          SET status='Rejected',updated_at=now()
        WHERE org_id=$1 AND problem_id=$2 AND profile_id=$3
          AND status='Suggested'
       RETURNING problem_id,repository,workspace_root,profile_id,profile_hash,
                 confidence,reasons,status,created_at,updated_at`,
      [input.orgId, input.problemId, input.profileId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ProblemRepositoryMatchError(
        "The repository suggestion is no longer available for review",
        409,
      );
    }
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,$5,'ProblemRepositoryMatch',$6,$7)`,
      [
        randomUUID(),
        input.orgId,
        input.actor.actorId,
        input.actor.actorName,
        `Rejected repository suggestion ${row.repository} at ${row.workspace_root}`,
        input.problemId,
        `${input.actor.traceId}_${randomUUID()}`,
      ],
    );
    return matchFromRow(row);
  });
}

export async function refreshPendingProblemRepositoryMatches(
  orgId: string,
  limit = 25,
): Promise<ProblemRepositoryMatchRefreshResult[]> {
  requirePostgresWorkspace(orgId, "Problem repository detection");
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const result = await databasePool().query<{ id: string }>(
    `SELECT problem.id
       FROM product_problems problem
      WHERE problem.org_id=$1 AND problem.stage <> 'Closed'
        AND NOT EXISTS (
          SELECT 1 FROM problem_repository_matches match
           WHERE match.org_id=problem.org_id AND match.problem_id=problem.id
             AND (
               match.status='Confirmed'
               OR (match.status='Suggested' AND match.confidence >= 0.68)
             )
        )
      ORDER BY problem.updated_at,problem.id
      LIMIT $2`,
    [orgId, boundedLimit],
  );
  const refreshed: ProblemRepositoryMatchRefreshResult[] = [];
  for (const row of result.rows) {
    refreshed.push(await refreshProblemRepositoryMatch(orgId, row.id));
  }
  return refreshed;
}
