import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  client: { query: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({
  databasePool: () => database.client,
  transaction: database.transaction,
}));

import {
  ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MESSAGE,
  ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MESSAGE,
  reconcileStaleIssueRuntimeVerifications,
} from "./issue-runtime-verification";

function githubClient() {
  return {
    rest: {
      actions: {
        getWorkflowRun: vi.fn(async ({ run_id }: { run_id: number }) => ({
          data: { id: run_id, status: "in_progress", conclusion: null },
        })),
        listWorkflowRuns: vi.fn(),
        listJobsForWorkflowRun: vi.fn(async () => ({
          data: {
            jobs: [{
              id: 201,
              name: "Reproduce reported issue",
              status: "queued",
              runner_id: 0,
              runner_name: "",
              steps: [],
            }],
          },
        })),
        cancelWorkflowRun: vi.fn(async () => ({ status: 202 })),
      },
    },
  };
}

describe("runtime verification timeout reconciliation", () => {
  beforeEach(() => {
    database.client.query.mockReset();
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) =>
        work(database.client),
    );
  });

  it("cancels stale unassigned and running GitHub workflows after recording their failures", async () => {
    const github = githubClient();
    database.client.query.mockImplementation(async (statement: unknown, values?: unknown[]) => {
      if (
        typeof statement === "string"
        && statement.includes("FROM issue_runtime_verification_runs")
        && statement.includes("ORDER BY requested_at")
      ) {
        return {
          rows: [
            {
              id: "run-queued",
              org_id: "org-1",
              investigation_id: "investigation-1",
              repository: "samshanmukh/zup",
              installation_id: "123",
              workflow_run_id: 101,
              status: "Queued",
              summary: "",
              requested_at: new Date("2026-08-12T11:50:00.000Z"),
              started_at: null,
            },
            {
              id: "run-running",
              org_id: "org-1",
              investigation_id: "investigation-2",
              repository: "samshanmukh/zup",
              installation_id: "123",
              workflow_run_id: 102,
              status: "Running",
              summary: "",
              requested_at: new Date("2026-08-12T09:59:00.000Z"),
              started_at: new Date("2026-08-12T10:00:00.000Z"),
            },
          ],
        };
      }
      if (typeof statement === "string" && statement.includes("UPDATE issue_runtime_verification_runs")) {
        return {
          rows: [{
            investigation_id: values?.[1] === "run-queued"
              ? "investigation-1"
              : "investigation-2",
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(reconcileStaleIssueRuntimeVerifications(
      "org-1",
      new Date("2026-08-12T12:00:00.000Z"),
      { createGithubClient: vi.fn(async () => github) } as never,
    )).resolves.toEqual({ queuedTimedOut: 1, runningTimedOut: 1 });

    const candidateQuery = database.client.query.mock.calls[0];
    expect(candidateQuery[1]).toEqual([
      "org-1",
      "2026-08-12T11:55:00.000Z",
      "2026-08-12T10:40:00.000Z",
    ]);
    expect(github.rest.actions.cancelWorkflowRun).toHaveBeenCalledTimes(2);
    expect(github.rest.actions.cancelWorkflowRun).toHaveBeenNthCalledWith(1, {
      owner: "samshanmukh",
      repo: "zup",
      run_id: 101,
    });
    expect(database.client.query.mock.calls.filter(([statement]) =>
      typeof statement === "string"
      && statement.includes("UPDATE investigations"))).toHaveLength(2);
    expect(database.client.query.mock.calls.filter(([statement]) =>
      typeof statement === "string"
      && statement.includes("INSERT INTO audit_events"))).toHaveLength(2);
    expect(database.client.query.mock.calls.filter(([statement]) =>
      typeof statement === "string"
      && statement.includes("UPDATE workspaces"))).toHaveLength(2);

    const failureUpdates = database.client.query.mock.calls.filter(([statement]) =>
      typeof statement === "string"
      && statement.includes("UPDATE issue_runtime_verification_runs")
      && statement.includes("failure_message"));
    expect(failureUpdates[0]?.[1]).toContain(ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MESSAGE);
    expect(failureUpdates[1]?.[1]).toContain(ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MESSAGE);
  });

  it("marks an assigned verification runner as running instead of timing it out", async () => {
    const github = githubClient();
    github.rest.actions.listJobsForWorkflowRun.mockResolvedValueOnce({
      data: {
        jobs: [{
          id: 201,
          name: "Reproduce reported issue",
          status: "in_progress",
          runner_id: 77,
          runner_name: "tenki-macos-runner-77",
          steps: [],
        }],
      },
    });
    database.client.query.mockImplementation(async (statement: unknown) => {
      if (
        typeof statement === "string"
        && statement.includes("FROM issue_runtime_verification_runs")
        && statement.includes("ORDER BY requested_at")
      ) {
        return {
          rows: [{
            id: "run-queued",
            org_id: "org-1",
            investigation_id: "investigation-1",
            repository: "samshanmukh/zup",
            installation_id: "123",
            workflow_run_id: 101,
            status: "Queued",
            summary: "",
            requested_at: new Date("2026-08-12T11:50:00.000Z"),
            started_at: null,
          }],
        };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(reconcileStaleIssueRuntimeVerifications(
      "org-1",
      new Date("2026-08-12T12:00:00.000Z"),
      { createGithubClient: vi.fn(async () => github) } as never,
    )).resolves.toEqual({ queuedTimedOut: 0, runningTimedOut: 0 });

    expect(github.rest.actions.cancelWorkflowRun).not.toHaveBeenCalled();
    expect(database.client.query.mock.calls.some(([statement]) =>
      typeof statement === "string"
      && statement.includes("status='Running'"))).toBe(true);
    expect(database.client.query.mock.calls.some(([statement]) =>
      typeof statement === "string"
      && statement.includes("UPDATE investigations"))).toBe(false);
  });

  it("does not touch investigations when no run crossed a deadline", async () => {
    database.client.query.mockResolvedValue({ rows: [] });

    await expect(reconcileStaleIssueRuntimeVerifications("org-1")).resolves.toEqual({
      queuedTimedOut: 0,
      runningTimedOut: 0,
    });
    expect(database.client.query).toHaveBeenCalledOnce();
  });
});
