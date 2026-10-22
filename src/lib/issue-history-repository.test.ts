import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), mode: vi.fn(() => "postgres") }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mocks.query }) }));
vi.mock("./workspace-persistence", () => ({ workspacePersistenceMode: mocks.mode }));
import { listIssueHistory } from "./issue-history-repository";
import type { AuditEvent } from "./domain";
import type { DemoState } from "./store";

const event = (id: string, entityId: string, traceId = "trace"): AuditEvent =>
  ({ id, orgId: "org_a", occurredAt: "2026-10-01T00:00:00Z", actorId: "u", actorName: "U", action: id, entityType: "ProductProblem", entityId, traceId });

describe("issue history", () => {
  beforeEach(() => { mocks.query.mockReset().mockResolvedValue({ rows: [] }); mocks.mode.mockReturnValue("postgres"); });

  it("keeps only the workflow events about this issue, its approval and its work item", async () => {
    const workflow = { approval: { id: "apr_1" }, workItem: { id: "GH-1" }, audit: [
      event("issue", "prob_1"), event("approval", "apr_1"), event("work", "GH-1"),
      event("traced", "other", "run-prob_1"), event("unrelated", "prob_2"),
    ] } as unknown as DemoState;
    const history = await listIssueHistory("org_a", "prob_1", workflow);
    expect(history.map((item) => item.id)).toEqual(["issue", "approval", "work", "traced"]);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("reads tenant-scoped events for an issue without a workflow", async () => {
    mocks.query.mockResolvedValue({ rows: [event("issue", "prob_1")] });
    expect((await listIssueHistory("org_a", "prob_1", null)).map((item) => item.id)).toEqual(["issue"]);
    expect(mocks.query.mock.calls[0][1]).toEqual(["org_a", "prob_1"]);
  });

  it("has no stored history for in-memory workspaces", async () => {
    mocks.mode.mockReturnValue("memory");
    expect(await listIssueHistory("org_demo", "prob_1", null)).toEqual([]);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
