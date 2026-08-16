import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  pool: { query: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({
  databasePool: () => database.pool,
  transaction: database.transaction,
}));

import {
  completePostReleaseVerification,
  recordGithubDeploymentStatus,
} from "./release-lifecycle-repository";

function sql(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ") : "";
}

describe("event-driven release lifecycle", () => {
  beforeEach(() => {
    database.client.query.mockReset();
    database.pool.query.mockReset();
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) => work(database.client),
    );
  });

  it("moves a tracked successful deployment to Released and queues verification", async () => {
    database.client.query.mockImplementation(async (statement: unknown) => {
      const normalized = sql(statement);
      if (normalized.includes("FROM final_execution_attempts")) {
        return { rows: [{
          agent_run_id: "run-1",
          problem_id: "problem-1",
          release_verification: "Run the production export and confirm every row is present.",
        }], rowCount: 1 };
      }
      if (normalized.includes("INSERT INTO release_events"))
        return { rows: [{ id: "release-1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });

    const outcome = await recordGithubDeploymentStatus(
      database.client as never,
      "org-1",
      "11111111-1111-4111-8111-111111111111",
      {
        repository: { full_name: "acme/api" },
        deployment: { sha: "b".repeat(40), environment: "production" },
        deployment_status: { state: "success", target_url: "https://deploy.example/1" },
      },
    );

    expect(outcome).toBe("tracked_deployment_succeeded_verification_queued");
    expect(database.client.query.mock.calls.some(([statement]) =>
      sql(statement).includes("SET stage='Released'"))).toBe(true);
    expect(database.client.query.mock.calls.some(([statement]) =>
      sql(statement).includes("'Release Ready'"))).toBe(true);
    expect(database.client.query.mock.calls.some(([statement]) =>
      sql(statement).includes("INSERT INTO post_release_verification_jobs"))).toBe(true);
  });

  it("records a failed deployment without marking the problem Released", async () => {
    database.client.query.mockImplementation(async (statement: unknown) => {
      const normalized = sql(statement);
      if (normalized.includes("FROM final_execution_attempts")) {
        return { rows: [{ agent_run_id: "run-1", problem_id: "problem-1", release_verification: "Verify." }], rowCount: 1 };
      }
      if (normalized.includes("INSERT INTO release_events"))
        return { rows: [{ id: "release-1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const outcome = await recordGithubDeploymentStatus(
      database.client as never,
      "org-1",
      "22222222-2222-4222-8222-222222222222",
      {
        repository: { full_name: "acme/api" },
        deployment: { sha: "b".repeat(40), environment: "production" },
        deployment_status: { state: "failure", description: "Health check failed" },
      },
    );
    expect(outcome).toBe("tracked_deployment_failed");
    expect(database.client.query.mock.calls.some(([statement]) =>
      sql(statement).includes("SET stage='Released'"))).toBe(false);
  });

  it("moves Released to Verified only after the automated verification passes", async () => {
    database.client.query.mockImplementation(async (statement: unknown) => {
      const normalized = sql(statement);
      if (normalized.includes("UPDATE post_release_verification_jobs"))
        return { rows: [{ problem_id: "problem-1", environment: "production", status: "Passed" }], rowCount: 1 };
      if (normalized.includes("SELECT id,revision FROM engineering_ticket_specifications"))
        return { rows: [{ id: "spec-1", revision: 3 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await completePostReleaseVerification("org-1", "job-1", {
      status: "Passed",
      evidence: "Production export included all expected rows and passed the smoke test.",
      result: {
        schemaVersion: 2,
        backend: { required: true, status: "Passed", checks: [{ passed: true }] },
        frontend: { required: true, status: "Passed", checks: [{ passed: true }] },
      },
    });
    expect(database.client.query.mock.calls.some(([statement]) =>
      sql(statement).includes("SET stage='Verified'"))).toBe(true);
    expect(database.client.query.mock.calls.some(([statement]) =>
      sql(statement).includes("INSERT INTO engineering_release_verifications"))).toBe(true);
  });

  it("does not move Released to Verified when a required production section failed", async () => {
    database.client.query.mockImplementation(async (statement: unknown) => {
      const normalized = sql(statement);
      if (normalized.includes("UPDATE post_release_verification_jobs"))
        return { rows: [{ problem_id: "problem-1", environment: "production", status: "Failed" }], rowCount: 1 };
      if (normalized.includes("SELECT id,revision FROM engineering_ticket_specifications"))
        return { rows: [{ id: "spec-1", revision: 3 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await completePostReleaseVerification("org-1", "job-1", {
      status: "Passed",
      evidence: "Top-level callback claimed success.",
      result: {
        schemaVersion: 2,
        backend: { required: true, status: "Passed", checks: [{ passed: true }] },
        frontend: { required: true, status: "Failed", checks: [{ passed: false }] },
      },
    });
    expect(database.client.query.mock.calls.some(([statement]) =>
      sql(statement).includes("SET stage='Verified'"))).toBe(false);
    const update = database.client.query.mock.calls.find(([statement]) =>
      sql(statement).includes("UPDATE post_release_verification_jobs"));
    expect(update?.[1]?.[2]).toBe("Failed");
  });

  it("accepts a duplicate callback after the durable job is already terminal", async () => {
    database.client.query.mockImplementation(async (statement: unknown) => {
      const normalized = sql(statement);
      if (normalized.includes("UPDATE post_release_verification_jobs"))
        return { rows: [], rowCount: 0 };
      if (normalized.includes("SELECT status FROM post_release_verification_jobs"))
        return { rows: [{ status: "Passed" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await expect(completePostReleaseVerification("org-1", "job-1", {
      status: "Passed",
      evidence: "Repeated delivery.",
      result: {
        schemaVersion: 2,
        backend: { required: true, status: "Passed", checks: [{ passed: true }] },
        frontend: { required: true, status: "Passed", checks: [{ passed: true }] },
      },
    })).resolves.toBeUndefined();
    expect(database.client.query.mock.calls.some(([statement]) =>
      sql(statement).includes("INSERT INTO engineering_release_verifications"))).toBe(false);
  });
});
