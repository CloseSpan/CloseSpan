import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptRuntimeSecret } from "./credential-crypto";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  pool: { query: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({
  databasePool: () => database.pool,
  transaction: database.transaction,
}));

vi.mock("./workspace-persistence", () => ({
  requirePostgresWorkspace: vi.fn(),
}));

import {
  createRuntimeSecret,
  resolveRuntimeSecretVersion,
  revokeRuntimeSecretVersion,
  rotateRuntimeSecret,
} from "./runtime-secret-repository";

const orgId = "org-1";
const secretId = "d53e4d93-d274-48f6-93a2-4f826fd3a4df";
const actor = {
  actorId: "admin-1",
  actorName: "Admin",
  idempotencyKey: "runtime_secret_request_123",
  traceId: "trace-1",
};

function sql(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ") : "";
}

function metadataRows(input: {
  versions?: Array<{ version: number; revokedAt?: Date | null }>;
  id?: string;
} = {}) {
  return (input.versions ?? [{ version: 1 }]).map((version) => ({
    id: input.id ?? secretId,
    environment_name: "DATABASE_URL",
    label: "Staging database",
    scope_type: "repository",
    repository: "acme/app",
    workspace_root: ".",
    secret_created_at: new Date("2026-08-01T00:00:00.000Z"),
    version: version.version,
    version_created_at: new Date(`2026-08-0${version.version}T00:00:00.000Z`),
    revoked_at: version.revokedAt ?? null,
  }));
}

describe("runtime secret repository", () => {
  beforeEach(() => {
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    database.pool.query.mockReset();
    database.client.query.mockReset();
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) =>
        work(database.client),
    );
  });

  afterEach(() => {
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  });

  it("encrypts a new value without persisting or returning plaintext metadata", async () => {
    database.client.query.mockImplementation(async (query: unknown) => {
      const normalized = sql(query);
      if (normalized.includes("create_idempotency_key=$2")) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("FROM runtime_secrets secret")) {
        return { rows: metadataRows(), rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const metadata = await createRuntimeSecret({
      orgId,
      environmentName: "DATABASE_URL",
      label: "Staging database",
      scopeType: "repository",
      repository: "acme/app",
      value: "postgres://plaintext-value",
      actor,
    });

    expect(JSON.stringify(metadata)).not.toContain("plaintext-value");
    const versionInsert = database.client.query.mock.calls.find(([query]) =>
      sql(query).includes("INSERT INTO runtime_secret_versions"),
    );
    expect(versionInsert).toBeDefined();
    expect(JSON.stringify(versionInsert?.[1])).not.toContain("plaintext-value");
    expect(sql(versionInsert?.[0])).not.toContain("fingerprint");
  });

  it("serializes concurrent create replays before checking the idempotency key", async () => {
    database.client.query.mockImplementation(async (query: unknown) => {
      const normalized = sql(query);
      if (normalized.includes("pg_advisory_xact_lock")) {
        return { rows: [], rowCount: 1 };
      }
      if (normalized.includes("create_idempotency_key=$2")) {
        return { rows: [{ id: secretId }], rowCount: 1 };
      }
      if (normalized.includes("FROM runtime_secrets secret")) {
        return { rows: metadataRows(), rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const metadata = await createRuntimeSecret({
      orgId,
      environmentName: "DATABASE_URL",
      label: "Staging database",
      scopeType: "repository",
      repository: "acme/app",
      value: "postgres://replayed-value",
      actor,
    });

    expect(metadata.id).toBe(secretId);
    const queries = database.client.query.mock.calls.map(([query]) => sql(query));
    expect(queries.findIndex((query) => query.includes("pg_advisory_xact_lock")))
      .toBeLessThan(queries.findIndex((query) => query.includes("create_idempotency_key=$2")));
    expect(queries.some((query) => query.includes("INSERT INTO runtime_secrets"))).toBe(false);
    expect(queries.some((query) => query.includes("INSERT INTO runtime_secret_versions"))).toBe(false);
  });

  it("rotates by inserting a new version and revokes the previous version by default", async () => {
    database.client.query.mockImplementation(async (query: unknown) => {
      const normalized = sql(query);
      if (normalized.includes("FROM runtime_secrets") && normalized.includes("FOR UPDATE")) {
        return { rows: [{ id: secretId }], rowCount: 1 };
      }
      if (normalized.includes("idempotency_key=$3")) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("ORDER BY version DESC LIMIT 1")) {
        return { rows: [{ version: 1 }], rowCount: 1 };
      }
      if (normalized.includes("FROM runtime_secrets secret")) {
        return {
          rows: metadataRows({
            versions: [
              { version: 2 },
              { version: 1, revokedAt: new Date("2026-08-02T00:00:00.000Z") },
            ],
          }),
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    const metadata = await rotateRuntimeSecret({
      orgId,
      secretId,
      value: "rotated-runtime-value",
      actor,
    });

    expect(metadata.versions.map((version) => version.version)).toEqual([2, 1]);
    const versionInsert = database.client.query.mock.calls.find(([query]) =>
      sql(query).includes("INSERT INTO runtime_secret_versions"),
    );
    expect(versionInsert?.[1]?.[2]).toBe(2);
    expect(JSON.stringify(versionInsert?.[1])).not.toContain("rotated-runtime-value");
    const revocationInsert = database.client.query.mock.calls.find(([query]) =>
      sql(query).includes("INSERT INTO runtime_secret_revocations"),
    );
    expect(revocationInsert?.[1]?.[2]).toBe(1);
  });

  it("records a revocation separately from its immutable version", async () => {
    database.client.query.mockImplementation(async (query: unknown) => {
      const normalized = sql(query);
      if (normalized.startsWith("SELECT version FROM runtime_secret_versions")) {
        return { rows: [{ version: 1 }], rowCount: 1 };
      }
      if (normalized.includes("INSERT INTO runtime_secret_revocations")) {
        return { rows: [{ version: 1 }], rowCount: 1 };
      }
      if (normalized.includes("FROM runtime_secrets secret")) {
        return {
          rows: metadataRows({
            versions: [
              { version: 1, revokedAt: new Date("2026-08-03T00:00:00.000Z") },
            ],
          }),
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    const metadata = await revokeRuntimeSecretVersion({
      orgId,
      secretId,
      version: 1,
      actor,
    });

    expect(metadata.versions[0]).toMatchObject({ version: 1, active: false });
    expect(database.client.query.mock.calls.some(([query]) =>
      sql(query).includes("UPDATE runtime_secret_versions"),
    )).toBe(false);
  });

  it("resolves only the exact active version within its repository scope", async () => {
    const encrypted = encryptRuntimeSecret("resolved-value", orgId, secretId, 2);
    database.pool.query.mockResolvedValue({
      rows: [{
        id: secretId,
        environment_name: "DATABASE_URL",
        label: "Staging database",
        scope_type: "repository",
        repository: "acme/app",
        workspace_root: ".",
        version: 2,
        encrypted_value: encrypted.ciphertext,
        value_iv: encrypted.iv,
        value_auth_tag: encrypted.authTag,
        key_id: encrypted.keyId,
        revoked_at: null,
      }],
      rowCount: 1,
    });

    await expect(resolveRuntimeSecretVersion({
      orgId,
      secretId,
      version: 2,
      repository: "acme/app",
    })).resolves.toMatchObject({
      environmentName: "DATABASE_URL",
      version: 2,
      value: "resolved-value",
    });

    await expect(resolveRuntimeSecretVersion({
      orgId,
      secretId,
      version: 2,
      repository: "acme/other",
    })).rejects.toThrow("does not belong");

    database.pool.query.mockResolvedValue({
      rows: [{
        ...(await database.pool.query()).rows[0],
        revoked_at: new Date("2026-08-04T00:00:00.000Z"),
      }],
      rowCount: 1,
    });
    await expect(resolveRuntimeSecretVersion({
      orgId,
      secretId,
      version: 2,
      repository: "acme/app",
    })).rejects.toThrow("revoked");
  });

  it("rejects executor-reserved environment names before opening a transaction", async () => {
    await expect(createRuntimeSecret({
      orgId,
      environmentName: "TENKI_API_KEY",
      value: "not-allowed",
      actor,
    })).rejects.toThrow("reserved");
    expect(database.transaction).not.toHaveBeenCalled();
  });
});
