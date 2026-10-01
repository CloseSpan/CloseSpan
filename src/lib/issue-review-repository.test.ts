import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workflows: vi.fn(), inbox: vi.fn(), autonomy: vi.fn(), demo: vi.fn() }));
vi.mock("./engineering-workflow-repository", () => ({ listEngineeringApprovalWorkflows: mocks.workflows }));
vi.mock("./problem-prompt-review-repository", () => ({ listProblemReviewInbox: mocks.inbox }));
vi.mock("./workspace-settings-repository", () => ({ readAutonomyLevel: mocks.autonomy }));
vi.mock("./presentation-demo", () => ({ readPresentationDemo: mocks.demo }));
import { readIssueReviewStates } from "./issue-review-repository";

describe("board review evidence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.workflows.mockResolvedValue([]);
    mocks.inbox.mockResolvedValue([]);
    mocks.autonomy.mockResolvedValue("Execute with approval");
    mocks.demo.mockResolvedValue(false);
  });

  it("uses current coding and final approvals, never decided approvals", async () => {
    mocks.workflows.mockResolvedValue([
      { problemId: "coding", approval: { status: "Pending" } },
      { problemId: "merge", finalApproval: { status: "Pending" } },
      { problemId: "done", approval: { status: "Approved" }, finalApproval: { status: "Expired" } },
      { problemId: "old", approval: { status: "Superseded" } },
    ]);
    expect(await readIssueReviewStates("org-a")).toEqual({ coding: "needed", merge: "needed" });
    for (const read of Object.values(mocks)) expect(read).toHaveBeenCalledWith("org-a");
  });

  it("matches the approval inbox's requirement-review policy", async () => {
    mocks.inbox.mockResolvedValue([{ problemId: "requirements", needsHelp: false }, { problemId: "help", needsHelp: true }]);
    expect(await readIssueReviewStates("org-a")).toEqual({ requirements: "needed", help: "attention" });
    mocks.autonomy.mockResolvedValue("Observe");
    expect(await readIssueReviewStates("org-a")).toEqual({ help: "attention" });
    mocks.demo.mockResolvedValue(true);
    expect(await readIssueReviewStates("org-a")).toEqual({ requirements: "needed", help: "attention" });
  });

  it("tolerates the same missing review migration as approvals, but does not hide other failures", async () => {
    mocks.inbox.mockRejectedValue({ code: "42P01" });
    expect(await readIssueReviewStates("org-a")).toEqual({});
    mocks.inbox.mockRejectedValue(new Error("Connection failed"));
    await expect(readIssueReviewStates("org-a")).rejects.toThrow("Connection failed");
  });
});
