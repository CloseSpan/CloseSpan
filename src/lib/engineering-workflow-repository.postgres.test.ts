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

vi.mock("./workspace-persistence", () => ({
  workspacePersistenceMode: () => "postgres",
}));

import {
  applyPddPromptRevision,
  approveImplementationRun,
  claimQueuedAgentRun,
  getAgentRunExecutionContext,
  markAgentRunRunning,
  rejectImplementationApproval,
  requestImplementationApproval,
  saveEngineeringSpecification,
} from "./engineering-workflow-repository";
import { hashExecutionProfileConfig } from "./execution-profile";

const actor = {
  actorId: "admin",
  actorName: "Admin",
  traceId: "trace-1",
  idempotencyKey: "workflow-1",
};

const profileConfig = {
  schemaVersion: 1 as const,
  language: "javascript",
  framework: null,
  packageManager: "npm",
  runtimeVersion: "22",
  workingDirectory: ".",
  installCommands: [],
  buildCommands: [],
  testCommands: ["npm test"],
  typecheckCommands: [],
  permittedPaths: ["src/**", "test/**"],
  tenkiImage: null,
  tenkiSnapshotId: null,
  cpuCores: 2,
  memoryMb: 4096,
  allowInbound: false,
  allowOutbound: false,
  maxDurationMs: 240_000,
  idleTimeoutMinutes: 2,
};
const profileHash = hashExecutionProfileConfig(profileConfig);
const profileId = "33333333-3333-4333-8333-333333333333";
const profileSnapshot = {
  profileId,
  version: 1,
  source: "confirmed",
  repository: "owner/repo",
  workspaceRoot: ".",
  contentHash: profileHash,
  config: profileConfig,
};
const verificationId = "44444444-4444-4444-8444-444444444444";
const promptId = "22222222-2222-4222-8222-222222222222";
const promptHash = "b".repeat(64);

function verificationRow() {
  return {
    id: verificationId,
    execution_profile_id: profileId,
    execution_profile_hash: profileHash,
    execution_profile_snapshot: profileSnapshot,
  };
}

function approvalRow(pddVerificationId: string | null) {
  return {
    id: "approval-1",
    problem_id: "problem-1",
    status: "Pending",
    expires_at: new Date("2099-01-01T00:00:00Z"),
    prompt_revision_id: promptId,
    prompt_hash: promptHash,
    repository: "owner/repo",
    base_branch: "main",
    base_sha: "a".repeat(40),
    pdd_verification_id: pddVerificationId,
    execution_profile_id: profileId,
    execution_profile_hash: profileHash,
    execution_profile_snapshot: profileSnapshot,
  };
}

function specificationDraft() {
  return {
    userStory: "As an analyst, I want exports fixed so that reports remain accurate.",
    currentBehavior: "Exports omit rows.",
    expectedBehavior: "Exports preserve every row.",
    reproductionSteps: ["Run an export."],
    businessOutcome: "Reports remain accurate.",
    acceptanceCriteria: [{ id: "AC-1", statement: "Every row is exported.", measurable: true }],
    testScenarios: [{
      id: "TEST-1",
      title: "Complete export",
      given: "A report with rows",
      when: "The report is exported",
      then: "Every row is present",
      testLevel: "unit",
      criterionIds: ["AC-1"],
    }],
    regressionScenarios: [],
    negativeScenarios: [],
    qualityExpectations: [],
    requiredTestLevels: ["unit"],
    releaseVerification: "Run the export after release.",
    nonGoals: [],
    permittedPaths: ["src/**", "test/**"],
    requiredCommands: ["npm test"],
    repository: "owner/repo",
    baseBranch: "main",
    baseSha: "a".repeat(40),
  };
}

function normalizedSql(sql: unknown): string {
  return typeof sql === "string" ? sql.replace(/\s+/g, " ") : "";
}

describe("PostgreSQL engineering workflow state guards", () => {
  beforeEach(() => {
    database.client.query.mockReset();
    database.pool.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) => work(database.client),
    );
  });

  it("makes duplicate started callbacks idempotent for queued and running runs", async () => {
    database.pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await markAgentRunRunning("org-1", "run-1", "sandbox-1");
    expect(normalizedSql(database.pool.query.mock.calls[0]?.[0]))
      .toContain("status IN ('Queued','Running')");
  });

  it("atomically claims a queued run only once before provisioning Tenki", async () => {
    database.pool.query.mockResolvedValueOnce({ rows: [{ status: "Running" }], rowCount: 1 });
    await expect(claimQueuedAgentRun("org-1", "run-1")).resolves.toBe("claimed");
    expect(normalizedSql(database.pool.query.mock.calls[0]?.[0]))
      .toContain("status='Queued'");
    expect(normalizedSql(database.pool.query.mock.calls[0]?.[0]))
      .toContain("sandbox_id='tenki:provisioning'");
    expect(normalizedSql(database.pool.query.mock.calls[0]?.[0]))
      .toContain("interval '13 minutes'");

    database.pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    database.pool.query.mockResolvedValueOnce({ rows: [{ status: "Running" }], rowCount: 1 });
    await expect(claimQueuedAgentRun("org-1", "run-1")).resolves.toBe("active");

    database.pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    database.pool.query.mockResolvedValueOnce({ rows: [{ status: "Failed" }], rowCount: 1 });
    await expect(claimQueuedAgentRun("org-1", "run-1")).resolves.toBe("terminal");
  });

  it("returns the immutable prompt to Ready when an approval is rejected", async () => {
    database.client.query.mockImplementation(async (sql: unknown) => {
      if (normalizedSql(sql).includes("UPDATE approval_requests SET status='Rejected'")) {
        return {
          rows: [{ problem_id: "problem-1", prompt_revision_id: "prompt-1" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    await rejectImplementationApproval("org-1", "approval-1", actor);
    expect(database.client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE implementation_prompts SET status='Ready'"),
      ["org-1", "prompt-1"],
    );
  });

  it("returns the immutable prompt to Ready when an approval expires", async () => {
    database.client.query.mockImplementation(async (sql: unknown) => {
      if (normalizedSql(sql).includes("FROM approval_requests")) {
        return {
          rows: [{
            id: "approval-1",
            problem_id: "problem-1",
            status: "Pending",
            expires_at: new Date("2020-01-01T00:00:00Z"),
            prompt_revision_id: "prompt-1",
            prompt_hash: "hash-1",
            repository: "owner/repo",
            base_branch: "main",
            base_sha: "a".repeat(40),
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(approveImplementationRun("org-1", "approval-1", actor))
      .rejects.toThrow("Approval expired");
    expect(database.client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE implementation_prompts SET status='Ready'"),
      ["org-1", "prompt-1"],
    );
  });

  it("reports a repeated PDD revision clearly instead of leaking a unique-constraint error", async () => {
    const currentHash = "c".repeat(64);
    database.client.query.mockImplementation(async (sql: unknown) => {
      const normalized = normalizedSql(sql);
      if (normalized.includes("status <> 'Superseded'") && normalized.includes("FOR UPDATE")) {
        return {
          rows: [{
            id: "current-prompt",
            specification_id: "specification-1",
            specification_revision: 1,
            revision: 4,
            status: "Ready",
            repository: "owner/repo",
            base_branch: "main",
            base_sha: "a".repeat(40),
            artifact_path: ".closespan/prompts/problem-1.prompt.md",
            structured_snapshot: {},
            content_hash: currentHash,
          }],
          rowCount: 1,
        };
      }
      if (normalized.includes("AND content_hash=$3")) {
        return { rows: [{ id: "prior-prompt", revision: 3 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(applyPddPromptRevision("org-1", "problem-1", {
      currentPromptHash: currentHash,
      revisedPrompt: "A previously tested immutable prompt revision.",
    }, actor)).rejects.toThrow("was already tested");
    expect(database.client.query.mock.calls.some(([sql]) =>
      normalizedSql(sql).includes("INSERT INTO implementation_prompts"),
    )).toBe(false);
  });

  it("stores the exact ready PDD verification on a new approval", async () => {
    database.client.query.mockImplementation(async (sql: unknown) => {
      const normalized = normalizedSql(sql);
      if (normalized.includes("FROM implementation_prompts") && normalized.includes("FOR UPDATE")) {
        return {
          rows: [{
            id: promptId,
            problem_id: "problem-1",
            status: "Ready",
            content_hash: promptHash,
            repository: "owner/repo",
            base_branch: "main",
            base_sha: "a".repeat(40),
          }],
          rowCount: 1,
        };
      }
      if (normalized.includes("FROM pdd_prompt_verifications")) {
        return { rows: [verificationRow()], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    await requestImplementationApproval("org-1", promptId, actor);

    const insert = database.client.query.mock.calls.find(([sql]) =>
      normalizedSql(sql).includes("INSERT INTO approval_requests"));
    expect(normalizedSql(insert?.[0])).toContain("pdd_verification_id");
    expect(insert?.[1]?.[14]).toBe(verificationId);
  });

  it("consumes the approval's exact PDD verification instead of reselecting the latest", async () => {
    database.client.query.mockImplementation(async (sql: unknown, parameters?: unknown[]) => {
      const normalized = normalizedSql(sql);
      if (normalized.includes("FROM approval_requests")) {
        return { rows: [approvalRow(verificationId)], rowCount: 1 };
      }
      if (normalized.includes("SELECT content_hash,status FROM implementation_prompts")) {
        return { rows: [{ content_hash: promptHash, status: "Awaiting approval" }], rowCount: 1 };
      }
      if (normalized.includes("FROM github_repository_allowlists")) {
        return { rows: [{ exists: 1 }], rowCount: 1 };
      }
      if (normalized.includes("FROM pdd_prompt_verifications")) {
        expect(parameters).toEqual(["org-1", verificationId, promptId, promptHash]);
        return { rows: [verificationRow()], rowCount: 1 };
      }
      if (normalized.includes("SELECT title FROM product_problems")) {
        return { rows: [{ title: "Bound PDD contract" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    await approveImplementationRun("org-1", "approval-1", actor);

    const verificationQuery = database.client.query.mock.calls.find(([sql]) =>
      normalizedSql(sql).includes("FROM pdd_prompt_verifications"));
    expect(normalizedSql(verificationQuery?.[0])).toContain("id=$2");
    expect(normalizedSql(verificationQuery?.[0])).not.toContain("ORDER BY completed_at");
    const runInsert = database.client.query.mock.calls.find(([sql]) =>
      normalizedSql(sql).includes("INSERT INTO agent_runs"));
    expect(runInsert?.[1]?.[10]).toBe(verificationId);
  });

  it("safely binds an unambiguous legacy approval before creating its run", async () => {
    database.client.query.mockImplementation(async (sql: unknown) => {
      const normalized = normalizedSql(sql);
      if (normalized.includes("FROM approval_requests")) {
        return { rows: [approvalRow(null)], rowCount: 1 };
      }
      if (normalized.includes("SELECT content_hash,status FROM implementation_prompts")) {
        return { rows: [{ content_hash: promptHash, status: "Awaiting approval" }], rowCount: 1 };
      }
      if (normalized.includes("FROM github_repository_allowlists")) {
        return { rows: [{ exists: 1 }], rowCount: 1 };
      }
      if (normalized.includes("FROM pdd_prompt_verifications")) {
        return { rows: [verificationRow()], rowCount: 1 };
      }
      if (normalized.includes("SELECT title FROM product_problems")) {
        return { rows: [{ title: "Legacy PDD contract" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    await approveImplementationRun("org-1", "approval-1", actor);

    const legacyLookup = database.client.query.mock.calls.find(([sql]) =>
      normalizedSql(sql).includes("FROM pdd_prompt_verifications"));
    expect(normalizedSql(legacyLookup?.[0])).toContain("ORDER BY completed_at");
    expect(database.client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET pdd_verification_id=$3"),
      ["org-1", "approval-1", verificationId],
    );
  });

  it("fails closed when an agent run and its approval reference different PDD contracts", async () => {
    database.pool.query.mockResolvedValueOnce({
      rows: [{
        run_pdd_verification_id: verificationId,
        approval_pdd_verification_id: "55555555-5555-4555-8555-555555555555",
      }],
      rowCount: 1,
    });

    await expect(getAgentRunExecutionContext("org-1", "11111111-1111-4111-8111-111111111111"))
      .rejects.toThrow("no longer matches its approval-bound acceptance contract");
    expect(normalizedSql(database.pool.query.mock.calls[0]?.[0]))
      .not.toContain("verification.status='Ready for approval'");
  });

  it("rejects ticket mutation before writing when an implementation approval is pending", async () => {
    database.client.query.mockImplementation(async (sql: unknown) => {
      const normalized = normalizedSql(sql);
      if (normalized.includes("FROM product_problems")) {
        return { rows: [{ exists: 1 }], rowCount: 1 };
      }
      if (normalized.includes("FROM approval_requests") && normalized.includes("status='Pending'")) {
        return { rows: [{ id: "approval-1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(saveEngineeringSpecification("org-1", "problem-1", specificationDraft(), actor))
      .rejects.toThrow("Reject or expire the pending implementation approval");

    expect(database.client.query.mock.calls.some(([sql]) =>
      normalizedSql(sql).includes("INSERT INTO engineering_ticket_specifications"))).toBe(false);
  });

  it("rejects ticket mutation before writing while an implementation run is active", async () => {
    database.client.query.mockImplementation(async (sql: unknown) => {
      const normalized = normalizedSql(sql);
      if (normalized.includes("FROM product_problems")) {
        return { rows: [{ exists: 1 }], rowCount: 1 };
      }
      if (normalized.includes("FROM approval_requests") && normalized.includes("status='Pending'")) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("FROM agent_runs") && normalized.includes("status IN")) {
        return { rows: [{ id: "run-1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(saveEngineeringSpecification("org-1", "problem-1", specificationDraft(), actor))
      .rejects.toThrow("Wait for or cancel the active implementation run");

    expect(database.client.query.mock.calls.some(([sql]) =>
      normalizedSql(sql).includes("INSERT INTO engineering_ticket_specifications"))).toBe(false);
  });

  it("preserves approval- and run-bound PDD contracts when saving a later ticket revision", async () => {
    database.client.query.mockImplementation(async (sql: unknown) => {
      const normalized = normalizedSql(sql);
      if (normalized.includes("FROM product_problems")) {
        return { rows: [{ exists: 1 }], rowCount: 1 };
      }
      if (normalized.includes("FROM approval_requests") && normalized.includes("status='Pending'")) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("FROM agent_runs") && normalized.includes("status IN")) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("FROM engineering_ticket_specifications") && normalized.includes("FOR UPDATE")) {
        return {
          rows: [{ id: "66666666-6666-4666-8666-666666666666", revision: 1 }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    await saveEngineeringSpecification("org-1", "problem-1", specificationDraft(), actor);

    const pddUpdate = database.client.query.mock.calls.find(([sql]) =>
      normalizedSql(sql).includes("UPDATE pdd_prompt_verifications verification"));
    expect(normalizedSql(pddUpdate?.[0])).toContain("approval.pdd_verification_id=verification.id");
    expect(normalizedSql(pddUpdate?.[0])).toContain("approval.status IN ('Pending','Approved')");
    expect(normalizedSql(pddUpdate?.[0])).toContain("run.pdd_verification_id=verification.id");
    expect(normalizedSql(pddUpdate?.[0])).toContain("run.status IN ('Queued','Running','Tests passed')");
  });
});
