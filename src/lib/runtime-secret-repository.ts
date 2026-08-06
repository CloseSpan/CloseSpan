import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  decryptRuntimeSecret,
  encryptRuntimeSecret,
} from "./credential-crypto";
import { databasePool, transaction } from "./db";
import {
  normalizeExecutionProfileScope,
  type ExecutionProfileSecretBinding,
} from "./execution-profile";
import type { RequestContext } from "./request-security";
import { requirePostgresWorkspace } from "./workspace-persistence";

const MAX_SECRET_BYTES = 16_384;

const environmentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "Environment names may contain letters, numbers, and underscores",
  )
  .superRefine((value, context) => {
    const normalized = value.toUpperCase();
    const reserved = new Set([
      "BASH_ENV",
      "CI",
      "ENV",
      "HOME",
      "LD_LIBRARY_PATH",
      "LD_PRELOAD",
      "NODE_OPTIONS",
      "OLDPWD",
      "PATH",
      "PORT",
      "PWD",
      "SHELL",
    ]);
    if (
      reserved.has(normalized)
      || normalized.startsWith("CLOSESPAN_")
      || normalized.startsWith("TENKI_")
    ) {
      context.addIssue({
        code: "custom",
        message: "This environment name is reserved by the isolated executor",
      });
    }
  });

const secretValueSchema = z
  .string()
  .min(4, "Runtime secrets must contain at least 4 characters")
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_SECRET_BYTES,
    "Secret values may not exceed 16 KB",
  )
  .refine((value) => !value.includes("\0"), "Secret values may not contain NUL bytes");

export type RuntimeSecretScopeType = "workspace" | "repository";

export interface RuntimeSecretScope {
  scopeType: RuntimeSecretScopeType;
  repository: string;
  workspaceRoot: string;
}

export interface RuntimeSecretVersionMetadata {
  version: number;
  active: boolean;
  createdAt: string;
  revokedAt: string | null;
}

export interface RuntimeSecretMetadata extends RuntimeSecretScope {
  id: string;
  environmentName: string;
  label: string;
  createdAt: string;
  versions: RuntimeSecretVersionMetadata[];
}

export interface ResolvedRuntimeSecret extends RuntimeSecretScope {
  id: string;
  environmentName: string;
  version: number;
  value: string;
}

export interface ResolvedRuntimeSecretBindings {
  setup: Record<string, string>;
  runtime: Record<string, string>;
  test: Record<string, string>;
  redactionValues: string[];
}

type RuntimeSecretActor = Pick<
  RequestContext,
  "actorId" | "actorName" | "idempotencyKey" | "traceId"
>;

interface RuntimeSecretMetadataRow {
  id: string;
  environment_name: string;
  label: string;
  scope_type: RuntimeSecretScopeType;
  repository: string;
  workspace_root: string;
  secret_created_at: Date;
  version: number;
  version_created_at: Date;
  revoked_at: Date | null;
}

interface RuntimeSecretRecordRow {
  id: string;
  environment_name: string;
  label: string;
  scope_type: RuntimeSecretScopeType;
  repository: string;
  workspace_root: string;
  version: number;
  encrypted_value: string;
  value_iv: string;
  value_auth_tag: string;
  key_id: string;
  revoked_at: Date | null;
}

export class RuntimeSecretError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function normalizeScope(input: {
  scopeType?: unknown;
  repository?: unknown;
  workspaceRoot?: unknown;
}): RuntimeSecretScope {
  const scopeType = z
    .enum(["workspace", "repository"])
    .parse(input.scopeType ?? "workspace");
  if (scopeType === "workspace") {
    return { scopeType, repository: "", workspaceRoot: "." };
  }
  if (typeof input.repository !== "string" || !input.repository.trim()) {
    throw new RuntimeSecretError(
      "A repository-scoped secret requires an owner/name repository",
      400,
    );
  }
  const scope = normalizeExecutionProfileScope({
    repository: input.repository,
    workspaceRoot:
      typeof input.workspaceRoot === "string" ? input.workspaceRoot : ".",
  });
  return { scopeType, ...scope };
}

function normalizeDefinition(input: {
  environmentName: unknown;
  label?: unknown;
  scopeType?: unknown;
  repository?: unknown;
  workspaceRoot?: unknown;
}) {
  const environmentName = environmentNameSchema
    .parse(input.environmentName)
    .toUpperCase();
  const label = z
    .string()
    .trim()
    .min(1)
    .max(120)
    .parse(input.label ?? environmentName);
  return {
    environmentName,
    label,
    ...normalizeScope(input),
  };
}

function metadataFromRows(
  rows: RuntimeSecretMetadataRow[],
): RuntimeSecretMetadata[] {
  const secrets = new Map<string, RuntimeSecretMetadata>();
  for (const row of rows) {
    const existing = secrets.get(row.id);
    const secret = existing ?? {
      id: row.id,
      environmentName: row.environment_name,
      label: row.label,
      scopeType: row.scope_type,
      repository: row.repository,
      workspaceRoot: row.workspace_root,
      createdAt: row.secret_created_at.toISOString(),
      versions: [],
    };
    secret.versions.push({
      version: row.version,
      active: row.revoked_at === null,
      createdAt: row.version_created_at.toISOString(),
      revokedAt: row.revoked_at?.toISOString() ?? null,
    });
    secrets.set(row.id, secret);
  }
  return [...secrets.values()];
}

const metadataQuery = `
  SELECT secret.id,secret.environment_name,secret.label,secret.scope_type,
         secret.repository,secret.workspace_root,
         secret.created_at AS secret_created_at,
         version.version,version.created_at AS version_created_at,
         revocation.revoked_at
    FROM runtime_secrets secret
    JOIN runtime_secret_versions version
      ON version.org_id=secret.org_id AND version.secret_id=secret.id
    LEFT JOIN runtime_secret_revocations revocation
      ON revocation.org_id=version.org_id
     AND revocation.secret_id=version.secret_id
     AND revocation.version=version.version
   WHERE secret.org_id=$1`;

async function loadRuntimeSecretMetadata(
  client: PoolClient,
  orgId: string,
  secretId?: string,
): Promise<RuntimeSecretMetadata[]> {
  const result = await client.query<RuntimeSecretMetadataRow>(
    `${metadataQuery}${secretId ? " AND secret.id=$2" : ""}
     ORDER BY secret.environment_name,secret.id,version.version DESC`,
    secretId ? [orgId, secretId] : [orgId],
  );
  return metadataFromRows(result.rows);
}

async function auditRuntimeSecret(
  client: PoolClient,
  orgId: string,
  actor: RuntimeSecretActor,
  secretId: string,
  action: string,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events(
       id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
     ) VALUES($1,$2,$3,$4,$5,'RuntimeSecret',$6,$7)
     ON CONFLICT(org_id,trace_id,action) DO NOTHING`,
    [
      randomUUID(),
      orgId,
      actor.actorId,
      actor.actorName,
      action,
      secretId,
      actor.traceId,
    ],
  );
}

function postgresCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : undefined;
}

export async function listRuntimeSecretMetadata(
  orgId: string,
): Promise<RuntimeSecretMetadata[]> {
  requirePostgresWorkspace(orgId, "Runtime secret settings");
  const result = await databasePool().query<RuntimeSecretMetadataRow>(
    `${metadataQuery}
     ORDER BY secret.environment_name,secret.id,version.version DESC`,
    [orgId],
  );
  return metadataFromRows(result.rows);
}

export async function createRuntimeSecret(input: {
  orgId: string;
  environmentName: unknown;
  label?: unknown;
  scopeType?: unknown;
  repository?: unknown;
  workspaceRoot?: unknown;
  value: unknown;
  actor: RuntimeSecretActor;
}): Promise<RuntimeSecretMetadata> {
  requirePostgresWorkspace(input.orgId, "Runtime secret settings");
  const definition = normalizeDefinition(input);
  const value = secretValueSchema.parse(input.value);
  try {
    return await transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`runtime-secret-create:${input.orgId}:${input.actor.idempotencyKey}`],
      );
      const replay = await client.query<{ id: string }>(
        `SELECT id FROM runtime_secrets
          WHERE org_id=$1 AND create_idempotency_key=$2`,
        [input.orgId, input.actor.idempotencyKey],
      );
      if (replay.rows[0]) {
        const existing = await loadRuntimeSecretMetadata(
          client,
          input.orgId,
          replay.rows[0].id,
        );
        if (!existing[0]) {
          throw new RuntimeSecretError("Runtime secret metadata is incomplete", 409);
        }
        return existing[0];
      }

      const secretId = randomUUID();
      const encrypted = encryptRuntimeSecret(value, input.orgId, secretId, 1);
      await client.query(
        `INSERT INTO runtime_secrets(
           id,org_id,environment_name,label,scope_type,repository,
           workspace_root,created_by,create_idempotency_key
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          secretId,
          input.orgId,
          definition.environmentName,
          definition.label,
          definition.scopeType,
          definition.repository,
          definition.workspaceRoot,
          input.actor.actorId,
          input.actor.idempotencyKey,
        ],
      );
      await client.query(
        `INSERT INTO runtime_secret_versions(
           org_id,secret_id,version,encrypted_value,value_iv,value_auth_tag,
           key_id,created_by,idempotency_key
         ) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8)`,
        [
          input.orgId,
          secretId,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          encrypted.keyId,
          input.actor.actorId,
          input.actor.idempotencyKey,
        ],
      );
      await auditRuntimeSecret(
        client,
        input.orgId,
        input.actor,
        secretId,
        "Created runtime secret version 1",
      );
      const created = await loadRuntimeSecretMetadata(
        client,
        input.orgId,
        secretId,
      );
      if (!created[0]) {
        throw new RuntimeSecretError("Runtime secret metadata is incomplete", 409);
      }
      return created[0];
    });
  } catch (error) {
    if (error instanceof RuntimeSecretError) throw error;
    if (postgresCode(error) === "23505") {
      throw new RuntimeSecretError(
        "That environment name already exists in this execution scope",
        409,
      );
    }
    throw error;
  }
}

export async function rotateRuntimeSecret(input: {
  orgId: string;
  secretId: string;
  value: unknown;
  revokePrevious?: boolean;
  actor: RuntimeSecretActor;
}): Promise<RuntimeSecretMetadata> {
  requirePostgresWorkspace(input.orgId, "Runtime secret settings");
  const secretId = z.string().uuid().parse(input.secretId);
  const value = secretValueSchema.parse(input.value);
  return transaction(async (client) => {
    const secret = await client.query<{ id: string }>(
      `SELECT id FROM runtime_secrets
        WHERE org_id=$1 AND id=$2 FOR UPDATE`,
      [input.orgId, secretId],
    );
    if (!secret.rows[0]) {
      throw new RuntimeSecretError("Runtime secret was not found", 404);
    }
    const replay = await client.query<{ version: number }>(
      `SELECT version FROM runtime_secret_versions
        WHERE org_id=$1 AND secret_id=$2 AND idempotency_key=$3`,
      [input.orgId, secretId, input.actor.idempotencyKey],
    );
    if (!replay.rows[0]) {
      const latest = await client.query<{ version: number }>(
        `SELECT version FROM runtime_secret_versions
          WHERE org_id=$1 AND secret_id=$2
          ORDER BY version DESC LIMIT 1`,
        [input.orgId, secretId],
      );
      const previousVersion = latest.rows[0]?.version ?? 0;
      const version = previousVersion + 1;
      const encrypted = encryptRuntimeSecret(
        value,
        input.orgId,
        secretId,
        version,
      );
      await client.query(
        `INSERT INTO runtime_secret_versions(
           org_id,secret_id,version,encrypted_value,value_iv,value_auth_tag,
           key_id,created_by,idempotency_key
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          input.orgId,
          secretId,
          version,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          encrypted.keyId,
          input.actor.actorId,
          input.actor.idempotencyKey,
        ],
      );
      if (input.revokePrevious !== false && previousVersion > 0) {
        await client.query(
          `INSERT INTO runtime_secret_revocations(
             org_id,secret_id,version,reason,revoked_by,idempotency_key
           ) VALUES($1,$2,$3,'Superseded by a rotated value',$4,$5)
           ON CONFLICT(org_id,secret_id,version) DO NOTHING`,
          [
            input.orgId,
            secretId,
            previousVersion,
            input.actor.actorId,
            input.actor.idempotencyKey,
          ],
        );
      }
      await auditRuntimeSecret(
        client,
        input.orgId,
        input.actor,
        secretId,
        `Rotated runtime secret to version ${version}`,
      );
    }
    const metadata = await loadRuntimeSecretMetadata(
      client,
      input.orgId,
      secretId,
    );
    if (!metadata[0]) {
      throw new RuntimeSecretError("Runtime secret metadata is incomplete", 409);
    }
    return metadata[0];
  });
}

export async function revokeRuntimeSecretVersion(input: {
  orgId: string;
  secretId: string;
  version: number;
  reason?: string;
  actor: RuntimeSecretActor;
}): Promise<RuntimeSecretMetadata> {
  requirePostgresWorkspace(input.orgId, "Runtime secret settings");
  const secretId = z.string().uuid().parse(input.secretId);
  const version = z.number().int().positive().parse(input.version);
  const reason = z
    .string()
    .trim()
    .min(1)
    .max(500)
    .parse(input.reason ?? "Revoked by a workspace administrator");
  return transaction(async (client) => {
    const current = await client.query<{ version: number }>(
      `SELECT version FROM runtime_secret_versions
        WHERE org_id=$1 AND secret_id=$2 AND version=$3`,
      [input.orgId, secretId, version],
    );
    if (!current.rows[0]) {
      throw new RuntimeSecretError("Runtime secret version was not found", 404);
    }
    const revoked = await client.query(
      `INSERT INTO runtime_secret_revocations(
         org_id,secret_id,version,reason,revoked_by,idempotency_key
       ) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(org_id,secret_id,version) DO NOTHING
       RETURNING version`,
      [
        input.orgId,
        secretId,
        version,
        reason,
        input.actor.actorId,
        input.actor.idempotencyKey,
      ],
    );
    if (revoked.rowCount) {
      await auditRuntimeSecret(
        client,
        input.orgId,
        input.actor,
        secretId,
        `Revoked runtime secret version ${version}`,
      );
    }
    const metadata = await loadRuntimeSecretMetadata(
      client,
      input.orgId,
      secretId,
    );
    if (!metadata[0]) {
      throw new RuntimeSecretError("Runtime secret metadata is incomplete", 409);
    }
    return metadata[0];
  });
}

export async function resolveRuntimeSecretVersion(input: {
  orgId: string;
  secretId: string;
  version: number;
  repository: string;
  workspaceRoot?: string;
}): Promise<ResolvedRuntimeSecret> {
  requirePostgresWorkspace(input.orgId, "Runtime secret resolution");
  const secretId = z.string().uuid().parse(input.secretId);
  const version = z.number().int().positive().parse(input.version);
  const target = normalizeExecutionProfileScope({
    repository: input.repository,
    workspaceRoot: input.workspaceRoot ?? ".",
  });
  const result = await databasePool().query<RuntimeSecretRecordRow>(
    `SELECT secret.id,secret.environment_name,secret.label,secret.scope_type,
            secret.repository,secret.workspace_root,version.version,
            version.encrypted_value,version.value_iv,version.value_auth_tag,
            version.key_id,revocation.revoked_at
       FROM runtime_secrets secret
       JOIN runtime_secret_versions version
         ON version.org_id=secret.org_id AND version.secret_id=secret.id
       LEFT JOIN runtime_secret_revocations revocation
         ON revocation.org_id=version.org_id
        AND revocation.secret_id=version.secret_id
        AND revocation.version=version.version
      WHERE secret.org_id=$1 AND secret.id=$2 AND version.version=$3`,
    [input.orgId, secretId, version],
  );
  const row = result.rows[0];
  if (!row) {
    throw new RuntimeSecretError("Runtime secret version was not found", 404);
  }
  if (
    row.scope_type === "repository"
    && (row.repository !== target.repository
      || row.workspace_root !== target.workspaceRoot)
  ) {
    throw new RuntimeSecretError(
      "Runtime secret does not belong to this repository scope",
      403,
    );
  }
  if (row.revoked_at) {
    throw new RuntimeSecretError("Runtime secret version has been revoked", 409);
  }
  return {
    id: row.id,
    environmentName: row.environment_name,
    scopeType: row.scope_type,
    repository: row.repository,
    workspaceRoot: row.workspace_root,
    version: row.version,
    value: decryptRuntimeSecret(
      {
        ciphertext: row.encrypted_value,
        iv: row.value_iv,
        authTag: row.value_auth_tag,
        keyId: row.key_id,
      },
      input.orgId,
      row.id,
      row.version,
    ),
  };
}

export async function validateRuntimeSecretBindings(input: {
  orgId: string;
  repository: string;
  workspaceRoot?: string;
  bindings: ExecutionProfileSecretBinding[];
}): Promise<void> {
  if (input.bindings.length === 0) return;
  requirePostgresWorkspace(input.orgId, "Runtime secret binding validation");
  const target = normalizeExecutionProfileScope({
    repository: input.repository,
    workspaceRoot: input.workspaceRoot ?? ".",
  });
  for (const binding of input.bindings) {
    const result = await databasePool().query<{
      environment_name: string;
      scope_type: RuntimeSecretScopeType;
      repository: string;
      workspace_root: string;
      revoked_at: Date | null;
    }>(
      `SELECT secret.environment_name,secret.scope_type,secret.repository,
              secret.workspace_root,revocation.revoked_at
         FROM runtime_secrets secret
         JOIN runtime_secret_versions version
           ON version.org_id=secret.org_id AND version.secret_id=secret.id
         LEFT JOIN runtime_secret_revocations revocation
           ON revocation.org_id=version.org_id
          AND revocation.secret_id=version.secret_id
          AND revocation.version=version.version
        WHERE secret.org_id=$1 AND secret.id=$2 AND version.version=$3`,
      [input.orgId, binding.secretId, binding.secretVersion],
    );
    const row = result.rows[0];
    if (!row) throw new RuntimeSecretError("Runtime secret version was not found", 404);
    if (row.revoked_at) throw new RuntimeSecretError("Runtime secret version has been revoked", 409);
    if (row.environment_name !== binding.envName) {
      throw new RuntimeSecretError(
        `Runtime secret ${binding.secretId} is registered for ${row.environment_name}, not ${binding.envName}`,
        409,
      );
    }
    if (
      row.scope_type === "repository"
      && (row.repository !== target.repository || row.workspace_root !== target.workspaceRoot)
    ) {
      throw new RuntimeSecretError(
        "Runtime secret does not belong to this repository scope",
        403,
      );
    }
  }
}

export async function resolveRuntimeSecretBindings(input: {
  orgId: string;
  repository: string;
  workspaceRoot?: string;
  bindings: ExecutionProfileSecretBinding[];
}): Promise<ResolvedRuntimeSecretBindings> {
  await validateRuntimeSecretBindings(input);
  const result: ResolvedRuntimeSecretBindings = {
    setup: {},
    runtime: {},
    test: {},
    redactionValues: [],
  };
  for (const binding of input.bindings) {
    const secret = await resolveRuntimeSecretVersion({
      orgId: input.orgId,
      secretId: binding.secretId,
      version: binding.secretVersion,
      repository: input.repository,
      workspaceRoot: input.workspaceRoot,
    });
    result[binding.exposure][binding.envName] = secret.value;
    result.redactionValues.push(secret.value);
  }
  return result;
}
