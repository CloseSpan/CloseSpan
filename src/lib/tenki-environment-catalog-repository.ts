import { databasePool, transaction } from "./db";
import {
  executionProfileExecutor,
  type ExecutionProfileConfig,
} from "./execution-profile";
import {
  isManagedTenkiArtifactRegistryRef,
  runtimeFamilyForExecutionProfile,
  selectManagedTenkiEnvironment,
  strictManagedTenkiCatalogMode,
  type ManagedTenkiEnvironmentArtifact,
  type ManagedTenkiEnvironmentRequest,
  type ManagedTenkiEnvironmentScope,
  type ManagedTenkiEnvironmentStatus,
} from "./tenki-environment-catalog";
import { requirePostgresWorkspace } from "./workspace-persistence";

interface ArtifactRow {
  id: string;
  scope_type: ManagedTenkiEnvironmentScope;
  org_id: string | null;
  repository: string;
  workspace_root: string;
  catalog_key: string;
  runtime_family: string;
  runtime_version: string | null;
  package_manager: string | null;
  capabilities: string[];
  dependency_fingerprint: string | null;
  source_sha: string | null;
  version: number;
  tenki_workspace_id: string | null;
  template_id: string | null;
  builder_session_id: string | null;
  template_spec_hash: string | null;
  build_id: string | null;
  snapshot_id: string | null;
  registry_image_id: string | null;
  registry_digest_ref: string | null;
  status: ManagedTenkiEnvironmentStatus;
  approved: boolean;
  expires_at: string | null;
  validation_session_id: string | null;
  last_verified_at: string | null;
  last_used_at: string | null;
}

function artifactFromRow(row: ArtifactRow): ManagedTenkiEnvironmentArtifact {
  return {
    id: row.id,
    scopeType: row.scope_type,
    orgId: row.org_id,
    repository: row.repository,
    workspaceRoot: row.workspace_root,
    catalogKey: row.catalog_key,
    runtimeFamily: row.runtime_family,
    runtimeVersion: row.runtime_version,
    packageManager: row.package_manager,
    capabilities: Array.isArray(row.capabilities)
      ? row.capabilities.filter((value): value is string => typeof value === "string")
      : [],
    dependencyFingerprint: row.dependency_fingerprint,
    sourceSha: row.source_sha,
    version: row.version,
    tenkiWorkspaceId: row.tenki_workspace_id,
    templateId: row.template_id,
    builderSessionId: row.builder_session_id,
    templateSpecHash: row.template_spec_hash,
    buildId: row.build_id,
    snapshotId: row.snapshot_id,
    registryImageId: row.registry_image_id,
    registryDigestRef: row.registry_digest_ref,
    status: row.status,
    approved: row.approved,
    expiresAt: row.expires_at,
    validationSessionId: row.validation_session_id,
    lastVerifiedAt: row.last_verified_at,
    lastUsedAt: row.last_used_at,
  };
}

function runtimeMajor(value: string | null): number | null {
  if (!value) return null;
  const match = /(?:^|\s|[<>=~^])v?(\d{1,3})(?:\D|$)/i.exec(value);
  return match ? Number(match[1]) : null;
}

const artifactColumns = `
  id,scope_type,org_id,repository,workspace_root,catalog_key,
  runtime_family,runtime_version,package_manager,capabilities,
  dependency_fingerprint,source_sha,version,tenki_workspace_id,template_id,
  builder_session_id,
  template_spec_hash,build_id,snapshot_id,registry_image_id,
  registry_digest_ref,status,approved,expires_at,validation_session_id,
  last_verified_at,last_used_at
`;

export function managedTenkiCatalogEnabled(): boolean {
  return process.env.TENKI_MANAGED_CATALOG_ENABLED?.trim().toLowerCase() === "true";
}

export function strictManagedTenkiCatalogEnabled(): boolean {
  return strictManagedTenkiCatalogMode();
}

export async function listManagedTenkiEnvironmentArtifacts(
  orgId: string,
): Promise<ManagedTenkiEnvironmentArtifact[]> {
  if (!managedTenkiCatalogEnabled()) return [];
  requirePostgresWorkspace(orgId, "Managed Tenki environments");
  const result = await databasePool().query<ArtifactRow>(
    `SELECT ${artifactColumns}
       FROM tenki_environment_artifacts
      WHERE scope_type='managed_toolchain' OR org_id=$1
      ORDER BY scope_type DESC,catalog_key,version DESC`,
    [orgId],
  );
  return result.rows.map(artifactFromRow);
}

export async function resolveManagedTenkiEnvironment(
  request: ManagedTenkiEnvironmentRequest,
): Promise<ManagedTenkiEnvironmentArtifact | null> {
  if (!managedTenkiCatalogEnabled()) return null;
  return selectManagedTenkiEnvironment(
    await listManagedTenkiEnvironmentArtifacts(request.orgId),
    request,
  );
}

export async function assertManagedTenkiBootSourceAllowed(input: {
  orgId: string;
  repository: string;
  workspaceRoot: string;
  config: ExecutionProfileConfig;
  permitDeprecated?: boolean;
}): Promise<ManagedTenkiEnvironmentArtifact | null> {
  if (executionProfileExecutor(input.config).kind === "tenki_github_actions") {
    return null;
  }
  if (!strictManagedTenkiCatalogEnabled()) return null;
  if (!input.config.tenkiImage && !input.config.tenkiSnapshotId) {
    throw new Error(
      "Strict Tenki catalog enforcement requires a validated digest-pinned managed environment",
    );
  }
  if (input.config.tenkiSnapshotId) {
    throw new Error(
      "Raw Tenki snapshots are not permitted by the managed catalog; select a digest-pinned managed image",
    );
  }
  const result = await databasePool().query<ArtifactRow>(
    `SELECT ${artifactColumns}
       FROM tenki_environment_artifacts
      WHERE registry_digest_ref=$1
        AND approved
        AND status = ANY($2::text[])
        AND (expires_at IS NULL OR expires_at > now())
        AND (
          scope_type='managed_toolchain'
          OR (
            scope_type='repository_private'
            AND org_id=$3
            AND repository=$4
            AND workspace_root=$5
          )
        )
      LIMIT 1`,
    [
      input.config.tenkiImage,
      input.permitDeprecated ? ["active", "deprecated"] : ["active"],
      input.orgId,
      input.repository,
      input.workspaceRoot,
    ],
  );
  const artifact = result.rows[0] ? artifactFromRow(result.rows[0]) : null;
  if (!artifact) {
    throw new Error(
      "The execution profile references a Tenki image that is not active in the trusted catalog",
    );
  }
  if (!isManagedTenkiArtifactRegistryRef(artifact)) {
    throw new Error(
      "The execution profile references a mutable or mismatched Tenki registry version",
    );
  }
  const expectedRuntime = runtimeFamilyForExecutionProfile(input.config);
  if (expectedRuntime && artifact.runtimeFamily !== expectedRuntime) {
    throw new Error(
      "The managed Tenki image does not match the execution profile runtime",
    );
  }
  const requestedMajor = runtimeMajor(input.config.runtimeVersion);
  const artifactMajor = runtimeMajor(artifact.runtimeVersion);
  if (
    requestedMajor !== null
    && artifactMajor !== null
    && requestedMajor !== artifactMajor
  ) {
    throw new Error(
      "The managed Tenki image does not match the execution profile runtime version",
    );
  }
  if (
    artifact.packageManager
    && input.config.packageManager !== "unknown"
    && artifact.packageManager !== input.config.packageManager
  ) {
    throw new Error(
      "The managed Tenki image does not match the execution profile package manager",
    );
  }
  if (
    input.config.schemaVersion === 2
    && input.config.runtimeTools.browser
    && !artifact.capabilities.includes("browser")
  ) {
    throw new Error(
      "The managed Tenki image does not provide the browser capability required by the execution profile",
    );
  }
  if (artifact.scopeType === "repository_private" && !input.permitDeprecated) {
    const assignment = await databasePool().query<{
      dependency_fingerprint: string | null;
    }>(
      `SELECT profile.detection_evidence->>'dependencyFingerprint'
              AS dependency_fingerprint
         FROM execution_profile_assignments assignment
         JOIN execution_profile_versions profile
           ON profile.org_id=assignment.org_id
          AND profile.id=COALESCE(
            assignment.detected_profile_id,
            assignment.active_profile_id
          )
        WHERE assignment.org_id=$1 AND assignment.repository=$2
          AND assignment.workspace_root=$3`,
      [input.orgId, input.repository, input.workspaceRoot],
    );
    if (
      !artifact.dependencyFingerprint
      || assignment.rows[0]?.dependency_fingerprint
        !== artifact.dependencyFingerprint
    ) {
      throw new Error(
        "The private Tenki environment does not match the repository's current dependency fingerprint",
      );
    }
  }
  return artifact;
}

export async function markManagedTenkiEnvironmentUsed(input: {
  artifactId: string;
  orgId: string;
  runId: string;
}): Promise<void> {
  await transaction(async (client) => {
    const updated = await client.query(
      `UPDATE tenki_environment_artifacts
          SET last_used_at=now(),updated_at=now()
        WHERE id=$1
          AND (scope_type='managed_toolchain' OR org_id=$2)
          AND status IN ('active','deprecated')`,
      [input.artifactId, input.orgId],
    );
    if (updated.rowCount !== 1) {
      throw new Error("The managed Tenki environment is no longer available");
    }
    await client.query(
      `INSERT INTO tenki_environment_artifact_events(
         id,artifact_id,event_type,detail,actor_id
       ) VALUES(gen_random_uuid(),$1,'execution.used',$2,'system:tenki-executor')`,
      [input.artifactId, JSON.stringify({ orgId: input.orgId, runId: input.runId })],
    );
  });
}
