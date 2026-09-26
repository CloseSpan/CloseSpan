import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(), analytics: vi.fn(), workflow: vi.fn(), reports: vi.fn(), review: vi.fn(),
}));
vi.mock("@/lib/auth-user", () => ({ requireWorkspaceUser: mocks.user }));
vi.mock("@/lib/overview-repository", () => ({ getOverviewAnalytics: mocks.analytics }));
vi.mock("@/lib/engineering-workflow-repository", () => ({ getEngineeringWorkflow: mocks.workflow }));
vi.mock("@/lib/issue-lifecycle-repository", () => ({ readIssueReports: mocks.reports }));
vi.mock("@/lib/problem-prompt-review-repository", () => ({ readProblemPromptReview: mocks.review }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
import IssueReportsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ orgId: "org-1", role: "Viewer" });
  mocks.analytics.mockResolvedValue({ problems: [{ id: "issue-1", title: "Missing menu actions", count: 1 }] });
  mocks.workflow.mockResolvedValue({ specification: { expectedBehavior: "The complete requirement.", currentBehavior: "Archive is missing." }, prompt: null, run: null });
  mocks.reports.mockResolvedValue([{ id: "report-1", quote: "I cannot archive this item.", source: "Slack", customer: "Avery" }]);
  mocks.review.mockResolvedValue(null);
});

describe("original issue reports", () => {
  it("shows full original evidence to a member using only the signed-in workspace", async () => {
    const html = renderToStaticMarkup(await IssueReportsPage({ params: Promise.resolve({ problemId: "issue-1" }) }));
    expect(html).toContain("I cannot archive this item.");
    expect(html).toContain("The complete requirement.");
    expect(html).toContain('href="/problems/issue-1"');
    expect(html).not.toContain("<button");
    expect(mocks.reports).toHaveBeenCalledWith("org-1", "issue-1");
    expect(mocks.workflow).toHaveBeenCalledWith("org-1", "issue-1");
  });
  it("does not read another issue when it is absent from the user's workspace", async () => {
    mocks.analytics.mockResolvedValue({ problems: [] });
    await expect(IssueReportsPage({ params: Promise.resolve({ problemId: "other-issue" }) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.reports).not.toHaveBeenCalled();
    expect(mocks.workflow).not.toHaveBeenCalled();
  });
});
