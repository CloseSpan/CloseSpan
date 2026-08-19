import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  pool: { query: vi.fn() },
  transaction: vi.fn(),
}));
const github = vi.hoisted(() => ({ verify: vi.fn(), createInstallationClient: vi.fn() }));
const installation = vi.hoisted(() => ({ sync: vi.fn() }));

vi.mock("./db", () => ({
  databasePool: () => database.pool,
  transaction: database.transaction,
}));
vi.mock("./github-app-auth", () => ({
  createGithubInstallationClient: github.createInstallationClient,
  verifyGithubInstallation: github.verify,
}));
vi.mock("./github-installation-repository", () => ({
  syncGithubInstallationRecords: installation.sync,
}));

import { processGithubWebhook } from "./github-webhook-repository";
import { GITHUB_ACTIONS_JOB_NOT_STARTED_MESSAGE } from "./runtime-verifier-errors";

const deliveryId = "11111111-1111-4111-8111-111111111111";

function sql(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ") : "";
}

describe("GitHub webhook persistence", () => {
  beforeEach(() => {
    database.pool.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    database.client.query.mockReset().mockImplementation(async (query: unknown) => {
      if (sql(query).includes("INSERT INTO github_webhook_deliveries"))
        return { rows: [{ delivery_id: deliveryId }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) => work(database.client),
    );
    github.verify.mockReset();
    github.createInstallationClient.mockReset().mockRejectedValue(new Error("diagnostics unavailable"));
    installation.sync.mockReset().mockResolvedValue(undefined);
  });

  it("acknowledges ping without tenant side effects", async () => {
    await expect(processGithubWebhook({
      deliveryId,
      event: "ping",
      rawBody: '{"zen":"hello"}',
      payload: {},
    })).resolves.toEqual({ accepted: true, duplicate: false, outcome: "ping_acknowledged" });
    expect(database.pool.query.mock.calls.some(([query]) => sql(query).includes("CREATE TABLE IF NOT EXISTS github_webhook_deliveries")))
      .toBe(true);
    expect(database.pool.query.mock.calls.some(([query]) => sql(query).includes("SELECT 1 FROM github_webhook_deliveries")))
      .toBe(true);
    expect(github.verify).not.toHaveBeenCalled();
  });

  it("deduplicates a repeated GitHub delivery", async () => {
    database.pool.query.mockImplementation(async (query: unknown) =>
      sql(query).includes("SELECT 1 FROM github_webhook_deliveries")
        ? { rows: [{ exists: 1 }], rowCount: 1 }
        : { rows: [], rowCount: 0 },
    );
    await expect(processGithubWebhook({
      deliveryId,
      event: "ping",
      rawBody: "{}",
      payload: {},
    })).resolves.toEqual({ accepted: true, duplicate: true, outcome: "duplicate" });
    expect(database.client.query).not.toHaveBeenCalled();
  });

  it("ignores an installation that was never bound through the signed callback", async () => {
    await expect(processGithubWebhook({
      deliveryId,
      event: "installation",
      rawBody: '{"action":"created","installation":{"id":150109806}}',
      payload: { action: "created", installation: { id: 150109806 } },
    })).resolves.toMatchObject({ outcome: "ignored_unbound_installation" });
    expect(github.verify).not.toHaveBeenCalled();
    expect(installation.sync).not.toHaveBeenCalled();
  });

  it("resynchronizes a previously bound installation from GitHub, not the payload", async () => {
    database.pool.query.mockImplementation(async (query: unknown) =>
      sql(query).includes("SELECT 1 FROM github_webhook_deliveries")
        ? { rows: [], rowCount: 0 }
        : sql(query).includes("FROM github_app_installations")
          ? { rows: [{ org_id: "org-1" }], rowCount: 1 }
          : { rows: [], rowCount: 0 },
    );
    const verified = {
      installationId: "150109806",
      accountId: "42",
      accountLogin: "acme",
      accountType: "Organization",
      repositorySelection: "selected",
      settingsUrl: "https://github.com/settings/installations/150109806",
      permissions: { contents: "write", pull_requests: "write" },
      repositories: [{ repository: "acme/api", defaultBranch: "main", private: true }],
    };
    github.verify.mockResolvedValue(verified);
    database.client.query.mockImplementation(async (query: unknown) => {
      if (sql(query).includes("INSERT INTO github_webhook_deliveries"))
        return { rows: [{ delivery_id: deliveryId }], rowCount: 1 };
      if (sql(query).includes("SELECT org_id FROM github_app_installations"))
        return { rows: [{ org_id: "org-1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const result = await processGithubWebhook({
      deliveryId,
      event: "installation_repositories",
      rawBody: '{"action":"added","installation":{"id":150109806}}',
      payload: { action: "added", installation: { id: 150109806 } },
    });
    expect(result.outcome).toBe("installation_synchronized");
    expect(github.verify).toHaveBeenCalledWith("150109806");
    expect(installation.sync).toHaveBeenCalledWith(database.client, "org-1", verified, {
      preserveWorkspaceRepositoryBindings: true,
    });
  });

  it("synchronizes one GitHub installation across every explicitly bound workspace", async () => {
    database.pool.query.mockImplementation(async (query: unknown) =>
      sql(query).includes("SELECT 1 FROM github_webhook_deliveries")
        ? { rows: [], rowCount: 0 }
        : sql(query).includes("FROM github_app_installations")
          ? { rows: [{ org_id: "org-1" }, { org_id: "org-2" }], rowCount: 2 }
          : { rows: [], rowCount: 0 },
    );
    const verified = {
      installationId: "150109806",
      accountId: "42",
      accountLogin: "acme",
      accountType: "Organization",
      repositorySelection: "selected",
      settingsUrl: "https://github.com/settings/installations/150109806",
      permissions: { contents: "write", pull_requests: "write" },
      repositories: [{ repository: "acme/api", defaultBranch: "main", private: true }],
    };
    github.verify.mockResolvedValue(verified);
    const result = await processGithubWebhook({
      deliveryId,
      event: "installation_repositories",
      rawBody: '{"action":"added","installation":{"id":150109806}}',
      payload: { action: "added", installation: { id: 150109806 } },
    });
    expect(result.outcome).toBe("installation_synchronized_for_2_workspaces");
    expect(github.verify).toHaveBeenCalledTimes(1);
    expect(installation.sync).toHaveBeenNthCalledWith(1, database.client, "org-1", verified, {
      preserveWorkspaceRepositoryBindings: true,
    });
    expect(installation.sync).toHaveBeenNthCalledWith(2, database.client, "org-2", verified, {
      preserveWorkspaceRepositoryBindings: true,
    });
    expect(database.client.query.mock.calls.filter(([query]) =>
      sql(query).includes("INSERT INTO github_webhook_delivery_workspaces"),
    )).toHaveLength(2);
    const deliveryInsert = database.client.query.mock.calls.find(([query]) =>
      sql(query).includes("INSERT INTO github_webhook_deliveries"),
    );
    expect(deliveryInsert?.[1]?.[4]).toBeNull();
  });

  it("audits only pull requests created by a tracked CloseSpan run", async () => {
    database.pool.query.mockImplementation(async (query: unknown) =>
      sql(query).includes("SELECT 1 FROM github_webhook_deliveries")
        ? { rows: [], rowCount: 0 }
        : sql(query).includes("FROM github_app_installations")
          ? { rows: [{ org_id: "org-1" }], rowCount: 1 }
          : { rows: [], rowCount: 0 },
    );
    database.client.query.mockImplementation(async (query: unknown) => {
      if (sql(query).includes("INSERT INTO github_webhook_deliveries"))
        return { rows: [{ delivery_id: deliveryId }], rowCount: 1 };
      if (sql(query).includes("FROM agent_runs run"))
        return { rows: [{ id: "run-1", problem_id: "problem-1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const result = await processGithubWebhook({
      deliveryId,
      event: "pull_request",
      rawBody: '{"action":"closed"}',
      payload: {
        action: "closed",
        installation: { id: 150109806 },
        repository: { full_name: "acme/api" },
        pull_request: { number: 12, merged: true },
      },
    });
    expect(result.outcome).toBe("tracked_pull_request_merged");
    expect(database.client.query.mock.calls.some(([query]) => sql(query).includes("INSERT INTO audit_events")))
      .toBe(true);
    expect(database.client.query.mock.calls.some(([query]) => sql(query).includes("UPDATE agent_runs")))
      .toBe(false);
    expect(database.client.query.mock.calls.some(([query]) => sql(query).includes("UPDATE final_execution_attempts")))
      .toBe(true);
    expect(database.client.query.mock.calls.some(([query]) =>
      sql(query).includes("SET stage='Release Ready'"),
    )).toBe(true);
    expect(database.client.query.mock.calls.some(([query]) =>
      sql(query).includes("implementation_state='Release Ready'"),
    )).toBe(true);
  });

  it("invalidates a pending final approval when GitHub reports a new PR head", async () => {
    database.pool.query.mockImplementation(async (query: unknown) =>
      sql(query).includes("SELECT 1 FROM github_webhook_deliveries")
        ? { rows: [], rowCount: 0 }
        : sql(query).includes("FROM github_app_installations")
          ? { rows: [{ org_id: "org-1" }], rowCount: 1 }
          : { rows: [], rowCount: 0 },
    );
    database.client.query.mockImplementation(async (query: unknown) => {
      if (sql(query).includes("INSERT INTO github_webhook_deliveries"))
        return { rows: [{ delivery_id: deliveryId }], rowCount: 1 };
      if (sql(query).includes("FROM agent_runs run"))
        return { rows: [{ id: "run-1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });

    const result = await processGithubWebhook({
      deliveryId,
      event: "pull_request",
      rawBody: '{"action":"synchronize"}',
      payload: {
        action: "synchronize",
        installation: { id: 150109806 },
        repository: { full_name: "acme/api" },
        pull_request: { number: 12, head: { sha: "c".repeat(40) } },
      },
    });

    expect(result.outcome).toBe("tracked_pull_request_synchronize");
    const invalidation = database.client.query.mock.calls.find(([query]) =>
      sql(query).includes("status='Superseded'")
    );
    expect(invalidation?.[1]).toEqual(["org-1", "run-1", "c".repeat(40)]);
  });

  it("stops and links an active verification when GitHub finishes without a callback", async () => {
    const runId = "13f4610c-942a-45fa-b475-11e6fe560625";
    database.pool.query.mockImplementation(async (query: unknown) =>
      sql(query).includes("SELECT 1 FROM github_webhook_deliveries")
        ? { rows: [], rowCount: 0 }
        : sql(query).includes("FROM github_app_installations")
          ? { rows: [{ org_id: "org-1" }], rowCount: 1 }
          : { rows: [], rowCount: 0 },
    );
    database.client.query.mockImplementation(async (query: unknown) => {
      if (sql(query).includes("INSERT INTO github_webhook_deliveries"))
        return { rows: [{ delivery_id: deliveryId }], rowCount: 1 };
      if (sql(query).includes("FROM issue_runtime_verification_runs run"))
        return { rows: [{ investigation_id: "investigation-1", status: "Queued" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });

    const result = await processGithubWebhook({
      deliveryId,
      event: "workflow_run",
      rawBody: '{"action":"completed"}',
      payload: {
        action: "completed",
        installation: { id: 150109806 },
        repository: { full_name: "samshanmukh/zup" },
        workflow_run: {
          id: 31746217439,
          name: "CloseSpan current-issue verifier",
          display_title: `CloseSpan verification ${runId}`,
          event: "workflow_dispatch",
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/samshanmukh/zup/actions/runs/31746217439",
          head_branch: "main",
          head_sha: "a".repeat(40),
        },
      },
    });

    expect(result.outcome).toBe("runtime_verification_failed_from_github_workflow");
    expect(database.client.query.mock.calls.some(([query]) =>
      sql(query).includes("workflow_run_id=$3") && sql(query).includes("status='Failed'"),
    )).toBe(true);
    expect(database.client.query.mock.calls.some(([query]) =>
      sql(query).includes("UPDATE investigations") && sql(query).includes("Verification blocked"),
    )).toBe(true);
  });

  it("records the GitHub diagnostic when a runtime verification never starts", async () => {
    const runId = "13f4610c-942a-45fa-b475-11e6fe560625";
    database.pool.query.mockImplementation(async (query: unknown) =>
      sql(query).includes("SELECT 1 FROM github_webhook_deliveries")
        ? { rows: [], rowCount: 0 }
        : sql(query).includes("FROM github_app_installations")
          ? { rows: [{ org_id: "org-1" }], rowCount: 1 }
          : { rows: [], rowCount: 0 },
    );
    database.client.query.mockImplementation(async (query: unknown) => {
      if (sql(query).includes("INSERT INTO github_webhook_deliveries"))
        return { rows: [{ delivery_id: deliveryId }], rowCount: 1 };
      if (sql(query).includes("FROM issue_runtime_verification_runs run"))
        return { rows: [{ investigation_id: "investigation-1", status: "Queued" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    github.createInstallationClient.mockResolvedValue({
      rest: {
        actions: {
          listJobsForWorkflowRun: vi.fn().mockResolvedValue({
            data: {
              jobs: [{ id: 42, conclusion: "failure", runner_id: 0, steps: [] }],
            },
          }),
        },
        checks: {
          listAnnotations: vi.fn().mockRejectedValue(new Error("Checks permission unavailable")),
        },
      },
    });

    const result = await processGithubWebhook({
      deliveryId,
      event: "workflow_run",
      rawBody: '{"action":"completed"}',
      payload: {
        action: "completed",
        installation: { id: 150109806 },
        repository: { full_name: "samshanmukh/zup" },
        workflow_run: {
          id: 31746217439,
          name: "CloseSpan current-issue verifier",
          display_title: `CloseSpan verification ${runId}`,
          status: "completed",
          conclusion: "failure",
          head_sha: "a".repeat(40),
        },
      },
    });

    expect(result.outcome).toBe("runtime_verification_failed_from_github_workflow");
    const runUpdate = database.client.query.mock.calls.find(([query]) =>
      sql(query).includes("UPDATE issue_runtime_verification_runs")
      && sql(query).includes("status='Failed'")
    );
    expect(runUpdate?.[1]?.[3]).toBe(GITHUB_ACTIONS_JOB_NOT_STARTED_MESSAGE);
  });

  it("stops an approval-bound run when GitHub finishes before its callback", async () => {
    const runId = "208b7b50-ad68-4e5b-9cd2-96e8b948aa8c";
    database.pool.query.mockImplementation(async (query: unknown) =>
      sql(query).includes("SELECT 1 FROM github_webhook_deliveries")
        ? { rows: [], rowCount: 0 }
        : sql(query).includes("FROM github_app_installations")
          ? { rows: [{ org_id: "org-1" }], rowCount: 1 }
          : { rows: [], rowCount: 0 },
    );
    database.client.query.mockImplementation(async (query: unknown) => {
      if (sql(query).includes("INSERT INTO github_webhook_deliveries"))
        return { rows: [{ delivery_id: deliveryId }], rowCount: 1 };
      if (sql(query).includes("FROM agent_runs run")) {
        return {
          rows: [{ problem_id: "problem-1", prompt_revision_id: "prompt-1", status: "Queued" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await processGithubWebhook({
      deliveryId,
      event: "workflow_run",
      rawBody: '{"action":"completed"}',
      payload: {
        action: "completed",
        installation: { id: 150109806 },
        repository: { full_name: "samshanmukh/zup" },
        workflow_run: {
          id: 31851413609,
          name: "CloseSpan approval-bound agent",
          event: "workflow_dispatch",
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/samshanmukh/zup/actions/runs/31851413609",
          head_branch: `closespan/runs/${runId}`,
          head_sha: "a".repeat(40),
        },
      },
    });

    expect(result.outcome).toBe("agent_workflow_failed_from_github_workflow");
    const runUpdate = database.client.query.mock.calls.find(([query]) =>
      sql(query).includes("UPDATE agent_runs") && sql(query).includes("failure_code=$4"),
    );
    expect(runUpdate?.[1]).toEqual([
      "org-1",
      runId,
      "Failed",
      "github_workflow_failure",
      expect.stringContaining("resolve the account, runner, or workflow failure"),
    ]);
    expect(database.client.query.mock.calls.some(([query]) =>
      sql(query).includes("implementation_state='Prompt ready'"),
    )).toBe(true);
    expect(database.client.query.mock.calls.some(([query]) =>
      sql(query).includes("UPDATE implementation_prompts SET status='Ready'"),
    )).toBe(true);
  });
});
