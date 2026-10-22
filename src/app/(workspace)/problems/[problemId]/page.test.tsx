import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  findState: vi.fn(), getWorkspaceProblem: vi.fn(), listIssueHistory: vi.fn(),
  primaryProblemId: "prob_primary",
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/lib/auth-user", () => ({ requireWorkspaceUser: async () => ({ orgId: "org_a", role: "Admin" }) }));
vi.mock("@/lib/issue-runtime-verification", () => ({ reconcileStaleIssueRuntimeVerifications: async () => undefined }));
vi.mock("@/lib/workspace-repository", () => ({
  getWorkspaceData: async () => ({
    primaryProblem: { id: state.primaryProblemId }, recommendation: {}, feedback: [],
    analytics: { problems: [{ id: "prob_primary", title: "Primary" }, { id: "prob_other", title: "Other" }] },
  }),
  getWorkspaceProblem: state.getWorkspaceProblem,
}));
vi.mock("@/lib/investigation-repository", () => ({ listWorkspaceInvestigations: async () => [] }));
vi.mock("@/lib/issue-conversation-repository", () => ({ readIssueConversation: async () => null }));
vi.mock("@/lib/presentation-demo", () => ({ readPresentationDemo: async () => null }));
vi.mock("@/lib/agent-run-findings-repository", () => ({ readIssueRunFindings: async () => [] }));
vi.mock("@/lib/automated-prompt-draft-repository", () => ({ readPromptDraftReadiness: async () => ({}) }));
vi.mock("@/lib/problem-evidence-bundle", () => ({ getProductProblemEvidenceBundle: async () => null }));
vi.mock("@/lib/store", () => ({ findState: state.findState }));
vi.mock("@/lib/issue-history-repository", () => ({ listIssueHistory: state.listIssueHistory }));
vi.mock("@/components/problem-discussion", () => ({ ProblemDiscussion: () => null }));
vi.mock("@/components/agent-run-finding", () => ({ AgentRunFinding: () => null }));
vi.mock("@/components/screens", () => ({
  GenericProblemScreen: ({ problem }: { problem: { id: string } }) => <section data-part="summary">{problem.id}</section>,
  ProductProblemInvestigationPanel: () => <section data-part="investigation" />,
  IssueFollowUp: ({ problem }: { problem: { id: string } }) => <section data-part="follow-up">{problem.id}</section>,
}));
vi.mock("@/components/problem-workspace", () => ({
  ProblemEvidence: ({ problem }: { problem: { id: string } }) => <section data-part="evidence">{problem.id}</section>,
  ProblemHistory: ({ audit }: { audit: unknown[] }) => <section data-part="history">{audit.length}</section>,
}));

import Page from "./page";

const render = async (problemId: string) =>
  renderToStaticMarkup(await Page({ params: Promise.resolve({ problemId }) }));
const parts = (markup: string) => [...markup.matchAll(/data-part="([^"]+)"/g)].map(([, part]) => part);

describe("issue page", () => {
  beforeEach(() => {
    state.findState.mockReset().mockResolvedValue(null);
    state.getWorkspaceProblem.mockReset().mockImplementation(async (_org: string, id: string) => ({ id }));
    state.listIssueHistory.mockReset().mockResolvedValue([]);
  });

  it("uses the same layout for the primary issue and every other issue", async () => {
    expect(parts(await render("prob_primary"))).toEqual(["summary", "evidence", "investigation"]);
    expect(parts(await render("prob_other"))).toEqual(["summary", "evidence", "investigation"]);
  });

  it("shows follow-up and history from that issue's own workflow", async () => {
    const workflow = { approval: { id: "apr_other", problemId: "prob_other" }, audit: [] };
    state.findState.mockResolvedValue(workflow);
    state.listIssueHistory.mockResolvedValue([{ id: "evt_1" }]);

    const markup = await render("prob_other");

    expect(state.findState).toHaveBeenCalledWith("org_a", "prob_other");
    expect(state.listIssueHistory).toHaveBeenCalledWith("org_a", "prob_other", workflow);
    expect(parts(markup)).toEqual(["summary", "evidence", "investigation", "follow-up", "history"]);
    expect(markup).toContain('data-part="follow-up">prob_other');
  });

  it("omits the evidence card when the issue's full record is unavailable", async () => {
    state.getWorkspaceProblem.mockResolvedValue(null);
    expect(parts(await render("prob_other"))).toEqual(["summary", "investigation"]);
  });

  it("rejects issues outside the workspace", async () => {
    await expect(render("prob_missing")).rejects.toThrow("not-found");
  });
});
