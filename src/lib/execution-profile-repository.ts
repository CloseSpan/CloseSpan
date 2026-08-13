import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import {
  SAFE_GENERIC_EXECUTION_PROFILE_CONFIG,
  assertExecutionProfileReadyForActivation,
  assertExecutionProfileScopeBoundary,
  hashExecutionProfileConfig,
  normalizeExecutionProfileScope,
  resolveExecutionProfile,
  sanitizeExecutionProfileConfig,
  type ExecutionProfileConfig,
  type ExecutionProfileScope,
  type ExecutionProfileSource,
  type ExecutionProfileVersion,
  type ProblemRepositoryMatchView,
  type ResolvedExecutionProfile,
} from "./execution-profile";
import { requirePostgresWorkspace } from "./workspace-persistence";

export interface ExecutionProfileActor {
  actorId: string;
  actorName?: string;
  traceId?: string;
}

export interface SaveDetectedExecutionProfileSuggestionInput
  extends Partial<Pick<ExecutionProfileScope, "workspaceRoot">> {
  orgId: string;
  repository: string;
  config: unknown;
  detectionEvidence?: Record<string, unknown>;
  actor: ExecutionProfileActor;
}

export interface ConfirmDetectedExecutionProfileInput {
  orgId: string;
  detectedProfileId: string;
  actor: ExecutionProfileActor;
}

export interface OverrideExecutionProfileInput
  extends Partial<ExecutionProfileScope> {
  orgId: string;
  config: unknown;
  parentProfileId?: string | null;
  actor: ExecutionProfileActor;
}

export interface ActivateExecutionProfileInput {
  orgId: string;
  profileId: string;
  actor: ExecutionProfileActor;
}

export interface ClearExecutionProfileAssignmentInput
  extends Partial<ExecutionProfileScope> {
  orgId: string;
  actor: ExecutionProfileActor;
}

export interface ResolveExecutionProfileForTicketInput
  extends Partial<Pick<ExecutionProfileScope, "workspaceRoot">> {
  orgId: string;
  repository: string;
  ticketOverrideProfileId?: string | null;
}

export interface ExecutionProfileAssignmentView extends ExecutionProfileScope {
  activeProfile: ExecutionProfileVersion | null;
  detectedProfile: ExecutionProfileVersion | null;
  updatedBy: string;
  updatedAt: string;
}

export interface ExecutionProfileSettingsView {
  assignments: ExecutionProfileAssignmentView[];
  safeGenericProfile: ExecutionProfileVersion;
}

interface ExecutionProfileRow {
  id: string;
  org_id: string;
  repository: string;
  workspace_root: string;
  version: number;
  source: ExecutionProfileSource;
  config: unknown;
  content_hash: string;
  parent_profile_id: string | null;
  detection_evidence: unknown;
  created_by: string;
  created_at: Date | string;
}

interface AssignmentRow {
  repository: string;
  workspace_root: string;
  active_profile_id: string | null;
  detected_profile_id: string | null;
  updated_by: string;
  updated_at: Date | string;
}

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function jsonObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return {};
  return structuredClone(parsed as Record<string, unknown>);
}

function profileFromRow(row: ExecutionProfileRow): ExecutionProfileVersion {
  const config = sanitizeExecutionProfileConfig(row.config);
  if (hashExecutionProfileConfig(config) !== row.content_hash) {
    throw new Error(`Execution profile ${row.id} failed its content hash check`);
  }
  return {
    id: row.id,
    orgId: row.org_id,
    repository: row.repository,
    workspaceRoot: row.workspace_root,
    version: row.version,
    source: row.source,
    config,
    contentHash: row.content_hash,
    parentProfileId: row.parent_profile_id,
    detectionEvidence: jsonObject(row.detection_evidence),
    createdBy: row.created_by,
    createdAt: isoDate(row.created_at),
  };
}

function evidenceSnapshot(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new Error("Execution profile detection evidence must be JSON serializable");
  }
  if (serialized.length > 50_000) {
    throw new Error("Execution profile detection evidence exceeds 50 KB");
  }
  const parsed = JSON.parse(serialized) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Execution profile detection evidence must be an object");
  }
  return parsed as Record<string, unknown>;
}

async function requireAuthorizedRepository(
  client: PoolClient,
  orgId: string,
  repository: string,
): Promise<void> {
  if (!repository) return;
  const result = await client.query(
    `SELECT 1 FROM github_repository_allowlists
      WHERE org_id=$1 AND repository=$2 AND active=true`,
    [orgId, repository],
  );
  if (result.rowCount !== 1) {
    throw new Error("Repository is not actively authorized for this workspace");
  }
}

async function getProfileWithClient(
  client: PoolClient,
  orgId: string,
  profileId: string,
  lock = false,
): Promise<ExecutionProfileVersion | null> {
  const result = await client.query<ExecutionProfileRow>(
    `SELECT id,org_id,repository,workspace_root,version,source,config,
            content_hash,parent_profile_id,detection_evidence,created_by,created_at
       FROM execution_profile_versions
      WHERE org_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [orgId, profileId],
  );
  return result.rows[0] ? profileFromRow(result.rows[0]) : null;
}

interface CreateVersionInput extends ExecutionProfileScope {
  orgId: string;
  source: ExecutionProfileSource;
  config: ExecutionProfileConfig;
  parentProfileId?: string | null;
  detectionEvidence?: Record<string, unknown>;
  createdBy: string;
}

async function lockProfileScope(
  client: PoolClient,
  orgId: string,
  scope: ExecutionProfileScope,
): Promise<void> {
  // PostgreSQL text parameters cannot contain NUL bytes. A serialized tuple
  // keeps each scope boundary unambiguous without introducing an invalid byte.
  const lockKey = JSON.stringify([orgId, scope.repository, scope.workspaceRoot]);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lockKey]);
}

async function createVersionWithClient(
  client: PoolClient,
  input: CreateVersionInput,
): Promise<ExecutionProfileVersion> {
  assertExecutionProfileScopeBoundary(input, input.config);
  const hash = hashExecutionProfileConfig(input.config);
  const evidence = evidenceSnapshot(input.detectionEvidence);
  await lockProfileScope(client, input.orgId, input);

  const existing = await client.query<ExecutionProfileRow>(
    `SELECT id,org_id,repository,workspace_root,version,source,config,
            content_hash,parent_profile_id,detection_evidence,created_by,created_at
      FROM execution_profile_versions
      WHERE org_id=$1 AND repository=$2 AND workspace_root=$3
        AND source=$4 AND content_hash=$5
        AND parent_profile_id IS NOT DISTINCT FROM $6::uuid
        AND detection_evidence=$7::jsonb`,
    [
      input.orgId,
      input.repository,
      input.workspaceRoot,
      input.source,
      hash,
      input.parentProfileId ?? null,
      JSON.stringify(evidence),
    ],
  );
  if (existing.rows[0]) return profileFromRow(existing.rows[0]);

  const versionResult = await client.query<{ version: number }>(
    `SELECT COALESCE(MAX(version),0)::integer + 1 AS version
       FROM execution_profile_versions
      WHERE org_id=$1 AND repository=$2 AND workspace_root=$3`,
    [input.orgId, input.repository, input.workspaceRoot],
  );
  const version = versionResult.rows[0]?.version ?? 1;
  const id = randomUUID();
  const inserted = await client.query<ExecutionProfileRow>(
    `INSERT INTO execution_profile_versions(
       id,org_id,repository,workspace_root,version,source,config,content_hash,
       parent_profile_id,detection_evidence,created_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id,org_id,repository,workspace_root,version,source,config,
               content_hash,parent_profile_id,detection_evidence,created_by,created_at`,
    [
      id,
      input.orgId,
      input.repository,
      input.workspaceRoot,
      version,
      input.source,
      JSON.stringify(input.config),
      hash,
      input.parentProfileId ?? null,
      JSON.stringify(evidence),
      input.createdBy,
    ],
  );
  if (!inserted.rows[0]) throw new Error("Execution profile version was not created");
  return profileFromRow(inserted.rows[0]);
}

async function setDetectedAssignment(
  client: PoolClient,
  profile: ExecutionProfileVersion,
  actorId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO execution_profile_assignments(
       org_id,repository,workspace_root,detected_profile_id,detected_profile_hash,
       created_by,updated_by
     ) VALUES($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT(org_id,repository,workspace_root) DO UPDATE SET
       detected_profile_id=excluded.detected_profile_id,
       detected_profile_hash=excluded.detected_profile_hash,
       updated_by=excluded.updated_by,
       updated_at=now()`,
    [
      profile.orgId,
      profile.repository,
      profile.workspaceRoot,
      profile.id,
      profile.contentHash,
      actorId,
    ],
  );
}

async function setActiveAssignment(
  client: PoolClient,
  profile: ExecutionProfileVersion,
  actorId: string,
): Promise<void> {
  if (profile.source === "detected") {
    throw new Error("A detected suggestion cannot be assigned as an active profile");
  }
  await client.query(
    `INSERT INTO execution_profile_assignments(
       org_id,repository,workspace_root,active_profile_id,active_profile_hash,
       created_by,updated_by
     ) VALUES($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT(org_id,repository,workspace_root) DO UPDATE SET
       active_profile_id=excluded.active_profile_id,
       active_profile_hash=excluded.active_profile_hash,
       updated_by=excluded.updated_by,
       updated_at=now()`,
    [
      profile.orgId,
      profile.repository,
      profile.workspaceRoot,
      profile.id,
      profile.contentHash,
      actorId,
    ],
  );
}

async function ensureSafeGenericWithClient(
  client: PoolClient,
  orgId: string,
): Promise<ExecutionProfileVersion> {
  return createVersionWithClient(client, {
    orgId,
    repository: "",
    workspaceRoot: ".",
    source: "safe_generic",
    config: sanitizeExecutionProfileConfig(SAFE_GENERIC_EXECUTION_PROFILE_CONFIG),
    createdBy: "system:execution-profile-fallback",
  });
}

export async function getExecutionProfileVersion(
  orgId: string,
  profileId: string,
): Promise<ExecutionProfileVersion | null> {
  requirePostgresWorkspace(orgId, "Execution profiles");
  const result = await databasePool().query<ExecutionProfileRow>(
    `SELECT id,org_id,repository,workspace_root,version,source,config,
            content_hash,parent_profile_id,detection_evidence,created_by,created_at
       FROM execution_profile_versions
      WHERE org_id=$1 AND id=$2`,
    [orgId, profileId],
  );
  return result.rows[0] ? profileFromRow(result.rows[0]) : null;
}

export async function ensureSafeGenericExecutionProfile(
  orgId: string,
): Promise<ExecutionProfileVersion> {
  requirePostgresWorkspace(orgId, "Execution profiles");
  return transaction((client) => ensureSafeGenericWithClient(client, orgId));
}

export async function saveDetectedExecutionProfileSuggestion(
  input: SaveDetectedExecutionProfileSuggestionInput,
): Promise<ExecutionProfileVersion> {
  requirePostgresWorkspace(input.orgId, "Execution profile detection");
  const scope = normalizeExecutionProfileScope(input);
  if (!scope.repository) throw new Error("Detected profiles require a repository");
  const config = sanitizeExecutionProfileConfig(input.config);
  const evidence = evidenceSnapshot(input.detectionEvidence);

  return transaction(async (client) => {
    await requireAuthorizedRepository(client, input.orgId, scope.repository);
    const profile = await createVersionWithClient(client, {
      orgId: input.orgId,
      ...scope,
      source: "detected",
      config,
      detectionEvidence: evidence,
      createdBy: input.actor.actorId,
    });
    await setDetectedAssignment(client, profile, input.actor.actorId);
    return profile;
  });
}

export async function confirmDetectedExecutionProfile(
  input: ConfirmDetectedExecutionProfileInput,
): Promise<ExecutionProfileVersion> {
  requirePostgresWorkspace(input.orgId, "Execution profile confirmation");
  return transaction(async (client) => {
    let detected = await getProfileWithClient(
      client,
      input.orgId,
      input.detectedProfileId,
    );
    if (!detected || detected.source !== "detected") {
      throw new Error("Detected execution profile was not found");
    }
    assertExecutionProfileReadyForActivation(detected.config);
    await lockProfileScope(client, input.orgId, detected);
    detected = await getProfileWithClient(
      client,
      input.orgId,
      input.detectedProfileId,
      true,
    );
    if (!detected || detected.source !== "detected") {
      throw new Error("Detected execution profile was not found");
    }
    await requireAuthorizedRepository(client, input.orgId, detected.repository);
    const assignment = await client.query<{
      detected_profile_id: string | null;
      active_profile_id: string | null;
    }>(
      `SELECT detected_profile_id,active_profile_id FROM execution_profile_assignments
        WHERE org_id=$1 AND repository=$2 AND workspace_root=$3
        FOR UPDATE`,
      [input.orgId, detected.repository, detected.workspaceRoot],
    );
    if (assignment.rows[0]?.detected_profile_id !== detected.id) {
      const priorConfirmation = await client.query<ExecutionProfileRow>(
        `SELECT id,org_id,repository,workspace_root,version,source,config,
                content_hash,parent_profile_id,detection_evidence,created_by,created_at
           FROM execution_profile_versions
          WHERE org_id=$1 AND repository=$2 AND workspace_root=$3
            AND source='confirmed' AND parent_profile_id=$4`,
        [input.orgId, detected.repository, detected.workspaceRoot, detected.id],
      );
      if (
        priorConfirmation.rows[0] &&
        assignment.rows[0]?.active_profile_id === priorConfirmation.rows[0].id
      ) {
        return profileFromRow(priorConfirmation.rows[0]);
      }
      throw new Error("A newer detected execution profile is awaiting review");
    }

    const confirmed = await createVersionWithClient(client, {
      orgId: input.orgId,
      repository: detected.repository,
      workspaceRoot: detected.workspaceRoot,
      source: "confirmed",
      config: detected.config,
      parentProfileId: detected.id,
      detectionEvidence: detected.detectionEvidence,
      createdBy: input.actor.actorId,
    });
    await setActiveAssignment(client, confirmed, input.actor.actorId);
    await client.query(
      `UPDATE execution_profile_assignments
          SET detected_profile_id=NULL,detected_profile_hash=NULL,
              updated_by=$4,updated_at=now()
        WHERE org_id=$1 AND repository=$2 AND workspace_root=$3
          AND detected_profile_id=$5`,
      [
        input.orgId,
        detected.repository,
        detected.workspaceRoot,
        input.actor.actorId,
        detected.id,
      ],
    );
    return confirmed;
  });
}

export async function overrideExecutionProfile(
  input: OverrideExecutionProfileInput,
): Promise<ExecutionProfileVersion> {
  requirePostgresWorkspace(input.orgId, "Execution profile settings");
  const scope = normalizeExecutionProfileScope(input);
  const config = sanitizeExecutionProfileConfig(input.config);

  return transaction(async (client) => {
    await requireAuthorizedRepository(client, input.orgId, scope.repository);
    await lockProfileScope(client, input.orgId, scope);
    if (input.parentProfileId) {
      const parent = await getProfileWithClient(
        client,
        input.orgId,
        input.parentProfileId,
        true,
      );
      if (
        !parent ||
        parent.repository !== scope.repository ||
        parent.workspaceRoot !== scope.workspaceRoot
      ) {
        throw new Error("Parent execution profile does not match this scope");
      }
    }
    const profile = await createVersionWithClient(client, {
      orgId: input.orgId,
      ...scope,
      source: "override",
      config,
      parentProfileId: input.parentProfileId,
      createdBy: input.actor.actorId,
    });
    await setActiveAssignment(client, profile, input.actor.actorId);
    if (input.parentProfileId) {
      await client.query(
        `UPDATE execution_profile_assignments
            SET detected_profile_id=NULL,detected_profile_hash=NULL,
                updated_by=$4,updated_at=now()
          WHERE org_id=$1 AND repository=$2 AND workspace_root=$3
            AND detected_profile_id=$5`,
        [
          input.orgId,
          scope.repository,
          scope.workspaceRoot,
          input.actor.actorId,
          input.parentProfileId,
        ],
      );
    }
    return profile;
  });
}

export async function createTicketExecutionProfileOverride(
  input: OverrideExecutionProfileInput,
): Promise<ExecutionProfileVersion> {
  requirePostgresWorkspace(input.orgId, "Ticket execution profile settings");
  const scope = normalizeExecutionProfileScope(input);
  if (!scope.repository) throw new Error("Ticket overrides require a repository");
  const config = sanitizeExecutionProfileConfig(input.config);

  return transaction(async (client) => {
    await requireAuthorizedRepository(client, input.orgId, scope.repository);
    await lockProfileScope(client, input.orgId, scope);
    if (input.parentProfileId) {
      const parent = await getProfileWithClient(
        client,
        input.orgId,
        input.parentProfileId,
        true,
      );
      if (
        !parent ||
        parent.repository !== scope.repository ||
        parent.workspaceRoot !== scope.workspaceRoot
      ) {
        throw new Error("Parent execution profile does not match this scope");
      }
    }
    return createVersionWithClient(client, {
      orgId: input.orgId,
      ...scope,
      source: "override",
      config,
      parentProfileId: input.parentProfileId,
      createdBy: input.actor.actorId,
    });
  });
}

export async function activateExecutionProfileVersion(
  input: ActivateExecutionProfileInput,
): Promise<ExecutionProfileVersion> {
  requirePostgresWorkspace(input.orgId, "Execution profile settings");
  return transaction(async (client) => {
    let profile = await getProfileWithClient(
      client,
      input.orgId,
      input.profileId,
    );
    if (!profile || profile.source === "detected" || profile.source === "safe_generic") {
      throw new Error("Confirmed execution profile was not found");
    }
    await lockProfileScope(client, input.orgId, profile);
    profile = await getProfileWithClient(
      client,
      input.orgId,
      input.profileId,
      true,
    );
    if (!profile || profile.source === "detected" || profile.source === "safe_generic") {
      throw new Error("Confirmed execution profile was not found");
    }
    await requireAuthorizedRepository(client, input.orgId, profile.repository);
    await setActiveAssignment(client, profile, input.actor.actorId);
    return profile;
  });
}

export async function clearExecutionProfileAssignment(
  input: ClearExecutionProfileAssignmentInput,
): Promise<void> {
  requirePostgresWorkspace(input.orgId, "Execution profile settings");
  const scope = normalizeExecutionProfileScope(input);
  await transaction(async (client) => {
    await lockProfileScope(client, input.orgId, scope);
    await client.query(
      `UPDATE execution_profile_assignments
          SET active_profile_id=NULL,active_profile_hash=NULL,
              updated_by=$4,updated_at=now()
        WHERE org_id=$1 AND repository=$2 AND workspace_root=$3`,
      [input.orgId, scope.repository, scope.workspaceRoot, input.actor.actorId],
    );
  });
}

export async function dismissDetectedExecutionProfileSuggestion(
  input: ActivateExecutionProfileInput,
): Promise<void> {
  requirePostgresWorkspace(input.orgId, "Execution profile settings");
  await transaction(async (client) => {
    let detected = await getProfileWithClient(
      client,
      input.orgId,
      input.profileId,
    );
    if (!detected || detected.source !== "detected") {
      throw new Error("Detected execution profile was not found");
    }
    await lockProfileScope(client, input.orgId, detected);
    detected = await getProfileWithClient(
      client,
      input.orgId,
      input.profileId,
      true,
    );
    if (!detected || detected.source !== "detected") {
      throw new Error("Detected execution profile was not found");
    }
    await client.query(
      `UPDATE execution_profile_assignments
          SET detected_profile_id=NULL,detected_profile_hash=NULL,
              updated_by=$4,updated_at=now()
        WHERE org_id=$1 AND repository=$2 AND workspace_root=$3
          AND detected_profile_id=$5`,
      [
        input.orgId,
        detected.repository,
        detected.workspaceRoot,
        input.actor.actorId,
        detected.id,
      ],
    );
  });
}

export async function listExecutionProfileSettings(
  orgId: string,
): Promise<ExecutionProfileSettingsView> {
  requirePostgresWorkspace(orgId, "Execution profile settings");
  return transaction(async (client) => {
    const safeGenericProfile = await ensureSafeGenericWithClient(client, orgId);
    const result = await client.query<AssignmentRow>(
      `SELECT repository,workspace_root,active_profile_id,detected_profile_id,
              updated_by,updated_at
         FROM execution_profile_assignments
        WHERE org_id=$1
        ORDER BY repository,workspace_root`,
      [orgId],
    );
    const profileIds = [...new Set(result.rows.flatMap((row) =>
      [row.active_profile_id, row.detected_profile_id].filter(
        (id): id is string => Boolean(id),
      ),
    ))];
    const profiles = profileIds.length
      ? await client.query<ExecutionProfileRow>(
        `SELECT id,org_id,repository,workspace_root,version,source,config,
                content_hash,parent_profile_id,detection_evidence,created_by,created_at
           FROM execution_profile_versions
          WHERE org_id=$1 AND id=ANY($2::uuid[])`,
        [orgId, profileIds],
      )
      : { rows: [] as ExecutionProfileRow[] };
    const byId = new Map(profiles.rows.map((row) => {
      const profile = profileFromRow(row);
      return [profile.id, profile] as const;
    }));
    return {
      safeGenericProfile,
      assignments: result.rows.map((row) => ({
        repository: row.repository,
        workspaceRoot: row.workspace_root,
        activeProfile: row.active_profile_id
          ? byId.get(row.active_profile_id) ?? null
          : null,
        detectedProfile: row.detected_profile_id
          ? byId.get(row.detected_profile_id) ?? null
          : null,
        updatedBy: row.updated_by,
        updatedAt: isoDate(row.updated_at),
      })),
    };
  });
}

export async function resolveExecutionProfileForTicket(
  input: ResolveExecutionProfileForTicketInput,
): Promise<ResolvedExecutionProfile> {
  requirePostgresWorkspace(input.orgId, "Execution profile resolution");
  const scope = normalizeExecutionProfileScope(input);
  if (!scope.repository) throw new Error("Ticket execution requires a repository");

  return transaction(async (client) => {
    const ticketOverride = input.ticketOverrideProfileId
      ? await getProfileWithClient(client, input.orgId, input.ticketOverrideProfileId)
      : null;
    if (input.ticketOverrideProfileId && !ticketOverride) {
      throw new Error("Ticket execution profile was not found");
    }

    const repositoryResult = await client.query<ExecutionProfileRow>(
      `SELECT p.id,p.org_id,p.repository,p.workspace_root,p.version,p.source,p.config,
              p.content_hash,p.parent_profile_id,p.detection_evidence,p.created_by,p.created_at
         FROM execution_profile_assignments a
         JOIN execution_profile_versions p
           ON p.org_id=a.org_id AND p.id=a.active_profile_id
          AND p.content_hash=a.active_profile_hash
        WHERE a.org_id=$1 AND a.repository=$2
          AND a.workspace_root=ANY($3::text[])
          AND a.active_profile_id IS NOT NULL
        ORDER BY CASE WHEN a.workspace_root=$4 THEN 0 ELSE 1 END
        LIMIT 1`,
      [
        input.orgId,
        scope.repository,
        scope.workspaceRoot === "." ? ["."] : [scope.workspaceRoot, "."],
        scope.workspaceRoot,
      ],
    );
    const repositoryAssignment = repositoryResult.rows[0]
      ? profileFromRow(repositoryResult.rows[0])
      : null;

    const workspaceResult = await client.query<ExecutionProfileRow>(
      `SELECT p.id,p.org_id,p.repository,p.workspace_root,p.version,p.source,p.config,
              p.content_hash,p.parent_profile_id,p.detection_evidence,p.created_by,p.created_at
         FROM execution_profile_assignments a
         JOIN execution_profile_versions p
           ON p.org_id=a.org_id AND p.id=a.active_profile_id
          AND p.content_hash=a.active_profile_hash
        WHERE a.org_id=$1 AND a.repository='' AND a.workspace_root='.'
          AND a.active_profile_id IS NOT NULL`,
      [input.orgId],
    );
    const workspaceDefault = workspaceResult.rows[0]
      ? profileFromRow(workspaceResult.rows[0])
      : null;
    const safeGeneric = await ensureSafeGenericWithClient(client, input.orgId);

    return resolveExecutionProfile({
      orgId: input.orgId,
      repository: scope.repository,
      workspaceRoot: scope.workspaceRoot,
      ticketOverride,
      repositoryAssignment,
      workspaceDefault,
      safeGeneric,
    });
  });
}

export async function saveProblemRepositoryMatch(input: {
  orgId: string;
  problemId: string;
  profileId: string;
  confidence: number;
  reasons: string[];
  status?: ProblemRepositoryMatchView["status"];
}): Promise<void> {
  requirePostgresWorkspace(input.orgId, "Problem repository matching");
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new Error("Repository match confidence must be between zero and one");
  }
  if (
    input.reasons.length > 50 ||
    input.reasons.some((reason) => !reason.trim() || reason.length > 2_000)
  ) {
    throw new Error(
      "Repository match reasons must be non-empty, limited to 2,000 characters, and limited to 50 items",
    );
  }
  await transaction(async (client) => {
    const profile = await getProfileWithClient(client, input.orgId, input.profileId);
    if (!profile || !profile.repository) {
      throw new Error("Repository match execution profile was not found");
    }
    await requireAuthorizedRepository(client, input.orgId, profile.repository);
    await client.query(
      `INSERT INTO problem_repository_matches(
         org_id,problem_id,repository,workspace_root,profile_id,profile_hash,
         confidence,reasons,status
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(org_id,problem_id,repository,workspace_root) DO UPDATE SET
         profile_id=CASE
           WHEN problem_repository_matches.status='Suggested' THEN excluded.profile_id
           ELSE problem_repository_matches.profile_id
         END,
         profile_hash=CASE
           WHEN problem_repository_matches.status='Suggested' THEN excluded.profile_hash
           ELSE problem_repository_matches.profile_hash
         END,
         confidence=CASE
           WHEN problem_repository_matches.status='Suggested' THEN excluded.confidence
           ELSE problem_repository_matches.confidence
         END,
         reasons=CASE
           WHEN problem_repository_matches.status='Suggested' THEN excluded.reasons
           ELSE problem_repository_matches.reasons
         END,
         status=CASE
           WHEN problem_repository_matches.status='Suggested' THEN excluded.status
           ELSE problem_repository_matches.status
         END,
         updated_at=now()`,
      [
        input.orgId,
        input.problemId,
        profile.repository,
        profile.workspaceRoot,
        profile.id,
        profile.contentHash,
        input.confidence,
        JSON.stringify(input.reasons.map((reason) => reason.trim())),
        input.status ?? "Suggested",
      ],
    );
  });
}

export async function listProblemRepositoryMatches(
  orgId: string,
  problemId: string,
): Promise<ProblemRepositoryMatchView[]> {
  requirePostgresWorkspace(orgId, "Problem repository matching");
  const result = await databasePool().query<{
    problem_id: string;
    repository: string;
    workspace_root: string;
    profile_id: string;
    profile_hash: string;
    confidence: number;
    reasons: string[];
    status: ProblemRepositoryMatchView["status"];
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    `SELECT problem_id,repository,workspace_root,profile_id,profile_hash,
            confidence,reasons,status,created_at,updated_at
       FROM problem_repository_matches
      WHERE org_id=$1 AND problem_id=$2
      ORDER BY CASE status WHEN 'Confirmed' THEN 0 WHEN 'Suggested' THEN 1 ELSE 2 END,
               confidence DESC,repository,workspace_root`,
    [orgId, problemId],
  );
  return result.rows.map((row) => ({
    problemId: row.problem_id,
    repository: row.repository,
    workspaceRoot: row.workspace_root,
    profileId: row.profile_id,
    profileHash: row.profile_hash,
    confidence: row.confidence,
    reasons: row.reasons,
    status: row.status,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  }));
}
