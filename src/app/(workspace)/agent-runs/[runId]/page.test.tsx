import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireWorkspaceUser: vi.fn(),
  getAgentRunById: vi.fn(),
  listAgentRuns: vi.fn(),
}));

vi.mock("@/lib/auth-user", () => ({ requireWorkspaceUser: mocks.requireWorkspaceUser }));
vi.mock("@/lib/engineering-workflow-repository", () => ({
  getAgentRunById: mocks.getAgentRunById,
  listAgentRuns: mocks.listAgentRuns,
}));
vi.mock("@/components/agent-run-summary", () => ({ AgentRunSummary: () => null }));
vi.mock("@/components/agent-run-auto-refresh", () => ({ AgentRunAutoRefresh: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); } }));

import Page from "./page";
import DetailsPage from "./details/page";

const params = Promise.resolve({ runId: "run_1" });
const run = {
  id: "run_1", status: "Draft PR opened", branchName: "closespan/internal-branch",
  failureCode: null, failureMessage: null, changedFiles: [], criterionResults: [],
  testResults: [{ command: "npm test", status: "passed", output: "Saved test evidence" }],
  logs: ["Saved executor evidence"],
};

describe("Agent run pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspaceUser.mockResolvedValue({ orgId: "org_1", role: "Admin" });
    mocks.getAgentRunById.mockResolvedValue({ problemId: "problem_1", run });
    mocks.listAgentRuns.mockResolvedValue([{ problemTitle: "Caption undo", finalExecutionStatus: "Succeeded" }]);
  });

  it("loads the exact workspace run and its latest state for the compact summary", async () => {
    const page = await Page({ params });
    expect(mocks.getAgentRunById).toHaveBeenCalledWith("org_1", "run_1");
    expect(mocks.listAgentRuns).toHaveBeenCalledWith("org_1", "run_1");
    expect(page.props).toMatchObject({ run, title: "Caption undo", problemId: "problem_1", isAdmin: true, finalExecutionStatus: "Succeeded" });
  });

  it("does not grant retry controls to a non-admin", async () => {
    mocks.requireWorkspaceUser.mockResolvedValue({ orgId: "org_1", role: "Contributor" });
    expect((await Page({ params })).props.isAdmin).toBe(false);
  });

  it("keeps technical evidence behind the same authenticated workspace lookup", async () => {
    const page = await DetailsPage({ params });
    expect(mocks.requireWorkspaceUser).toHaveBeenCalled();
    expect(mocks.getAgentRunById).toHaveBeenCalledWith("org_1", "run_1");
    const markup = renderToStaticMarkup(page);
    expect(markup).toContain('href="/agent-runs/run_1"');
    expect(markup).toContain("Saved executor evidence");
    expect(markup).toContain("Saved test evidence");
    expect(markup).toContain("npm test");
  });

  it.each([Page, DetailsPage])("rejects a missing or other-workspace run", async (route) => {
    mocks.getAgentRunById.mockResolvedValue(null);
    await expect(route({ params })).rejects.toThrow("not-found");
    expect(mocks.listAgentRuns).not.toHaveBeenCalled();
  });

  it.each([Page, DetailsPage])("requires authentication before querying run data", async (route) => {
    mocks.requireWorkspaceUser.mockRejectedValue(new Error("sign-in-required"));
    await expect(route({ params })).rejects.toThrow("sign-in-required");
    expect(mocks.getAgentRunById).not.toHaveBeenCalled();
  });
});
