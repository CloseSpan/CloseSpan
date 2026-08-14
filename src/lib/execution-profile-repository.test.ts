import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({
  databasePool: () => ({ query: vi.fn() }),
  transaction: database.transaction,
}));

vi.mock("./workspace-persistence", () => ({
  requirePostgresWorkspace: vi.fn(),
}));

import {
  clearExecutionProfileAssignment,
  listExecutionProfileSettings,
  saveDetectedExecutionProfileSuggestion,
} from "./execution-profile-repository";
import {
  SAFE_GENERIC_EXECUTION_PROFILE_CONFIG,
  hashExecutionProfileConfig,
} from "./execution-profile";

function normalizedSql(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ") : "";
}

describe("execution profile repository locking", () => {
  beforeEach(() => {
    database.client.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) =>
        work(database.client),
    );
  });

  it("uses NUL-free, scope-unique advisory lock parameters", async () => {
    const scopes = [
      { orgId: "org-alpha", repository: "acme/widget", workspaceRoot: "." },
      { orgId: "org-alpha", repository: "acme/widget", workspaceRoot: "apps/web" },
      { orgId: "org-alpha", repository: "acme/api", workspaceRoot: "." },
      { orgId: "org-beta", repository: "acme/widget", workspaceRoot: "." },
    ];

    for (const scope of scopes) {
      await clearExecutionProfileAssignment({
        ...scope,
        actor: { actorId: "admin-1" },
      });
    }

    const lockCalls = database.client.query.mock.calls.filter(([query]) =>
      normalizedSql(query).includes(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      ),
    );
    const lockKeys = lockCalls.map(([, parameters]) => parameters?.[0]);

    expect(lockCalls).toHaveLength(scopes.length);
    expect(lockKeys).toEqual(scopes.map((scope) => JSON.stringify([
      scope.orgId,
      scope.repository,
      scope.workspaceRoot,
    ])));
    expect(lockKeys.every((key) =>
      typeof key === "string" && !key.includes("\u0000"),
    )).toBe(true);
    expect(new Set(lockKeys).size).toBe(scopes.length);
  });

  it("does not expose an already-confirmed detection as a pending update", async () => {
    const detectedId = "11111111-1111-4111-8111-111111111111";
    const activeId = "22222222-2222-4222-8222-222222222222";
    const hash = hashExecutionProfileConfig(SAFE_GENERIC_EXECUTION_PROFILE_CONFIG);
    const createdAt = new Date("2026-08-14T12:00:00.000Z");
    const detected = {
      id: detectedId,
      org_id: "org-1",
      repository: "acme/widget",
      workspace_root: ".",
      version: 1,
      source: "detected",
      config: SAFE_GENERIC_EXECUTION_PROFILE_CONFIG,
      content_hash: hash,
      parent_profile_id: null,
      detection_evidence: {},
      created_by: "detector",
      created_at: createdAt,
    };
    const active = {
      ...detected,
      id: activeId,
      version: 2,
      source: "confirmed",
      parent_profile_id: detectedId,
      created_by: "admin",
    };
    const safe = {
      ...detected,
      id: "33333333-3333-4333-8333-333333333333",
      repository: "",
      version: 1,
      source: "safe_generic",
      created_by: "system",
    };
    database.client.query.mockImplementation(async (query: unknown) => {
      const sql = normalizedSql(query);
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("source=$4") && sql.includes("content_hash=$5")) {
        return { rows: [safe], rowCount: 1 };
      }
      if (sql.includes("FROM execution_profile_assignments") && sql.includes("ORDER BY repository")) {
        return {
          rows: [{
            repository: "acme/widget",
            workspace_root: ".",
            active_profile_id: activeId,
            detected_profile_id: detectedId,
            automatic_activation_disabled: false,
            updated_by: "detector",
            updated_at: createdAt,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("id=ANY($2::uuid[])")) {
        return { rows: [active, detected], rowCount: 2 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const settings = await listExecutionProfileSettings("org-1");

    expect(settings.assignments[0]?.activeProfile?.id).toBe(activeId);
    expect(settings.assignments[0]?.detectedProfile).toBeNull();
  });

  it("prevents repository refresh from re-queuing an activated detection", async () => {
    const detectedId = "11111111-1111-4111-8111-111111111111";
    const hash = hashExecutionProfileConfig(SAFE_GENERIC_EXECUTION_PROFILE_CONFIG);
    const detected = {
      id: detectedId,
      org_id: "org-1",
      repository: "acme/widget",
      workspace_root: ".",
      version: 1,
      source: "detected",
      config: SAFE_GENERIC_EXECUTION_PROFILE_CONFIG,
      content_hash: hash,
      parent_profile_id: null,
      detection_evidence: {},
      created_by: "detector",
      created_at: new Date("2026-08-14T12:00:00.000Z"),
    };
    database.client.query.mockImplementation(async (query: unknown) => {
      const sql = normalizedSql(query);
      if (sql.includes("SELECT 1 FROM github_repository_allowlists")) {
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      }
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("source=$4") && sql.includes("content_hash=$5")) {
        return { rows: [detected], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO execution_profile_assignments")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    await saveDetectedExecutionProfileSuggestion({
      orgId: "org-1",
      repository: "acme/widget",
      config: SAFE_GENERIC_EXECUTION_PROFILE_CONFIG,
      actor: { actorId: "detector" },
    });

    const assignmentSql = database.client.query.mock.calls
      .map(([query]) => normalizedSql(query))
      .find((sql) => sql.includes("INSERT INTO execution_profile_assignments"));
    expect(assignmentSql).toContain(
      "active.parent_profile_id=excluded.detected_profile_id",
    );
    expect(assignmentSql).toContain("THEN NULL");
  });
});
