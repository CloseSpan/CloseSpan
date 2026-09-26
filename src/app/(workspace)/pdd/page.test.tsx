import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: vi.fn(), analytics: vi.fn(), investigations: vi.fn(), workflow: vi.fn(),
  repository: vi.fn(), persistence: vi.fn(),
}));
vi.mock("@/lib/auth-user", () => ({ requireWorkspaceUser: state.user }));
vi.mock("@/lib/overview-repository", () => ({ getOverviewAnalytics: state.analytics }));
vi.mock("@/lib/investigation-repository", () => ({ listWorkspaceInvestigations: state.investigations }));
vi.mock("@/lib/engineering-workflow-repository", () => ({ getEngineeringWorkflow: state.workflow }));
vi.mock("@/lib/problem-repository-match-repository", () => ({ getActiveConfirmedProblemRepositoryMatch: state.repository }));
vi.mock("@/lib/workspace-persistence", () => ({ workspacePersistenceMode: state.persistence }));
vi.mock("@/components/screens", () => ({ PddPrioritizationScreen: () => null }));

import Page from "./page";

describe("production Prompt Testing entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user.mockResolvedValue({ orgId: "org-current" });
    state.analytics.mockResolvedValue({ problems: [{ id: "open", stage: "Needs review" }, { id: "closed", stage: "Closed" }] });
    state.investigations.mockResolvedValue([{ problemId: "open" }]);
    state.workflow.mockResolvedValue({ prompt: null });
    state.repository.mockResolvedValue(null);
    state.persistence.mockReturnValue("postgres");
  });

  it("loads open tasks with their actual repository readiness", async () => {
    const page = await Page();
    expect(page.props.problems).toEqual([{ id: "open", stage: "Needs review" }]);
    expect(page.props.repositoryReadyByProblem).toEqual({ open: false });
    expect(page.props.workflows).toEqual({ open: { prompt: null } });
    expect(state.analytics).toHaveBeenCalledWith("org-current");
    expect(state.investigations).toHaveBeenCalledWith("org-current");
    expect(state.workflow).toHaveBeenCalledExactlyOnceWith("org-current", "open");
    expect(state.repository).toHaveBeenCalledExactlyOnceWith("org-current", "open");
  });

  it("preserves demo-mode readiness without reading a real repository", async () => {
    state.persistence.mockReturnValue("memory");
    const page = await Page();
    expect(page.props.repositoryReadyByProblem).toEqual({ open: true });
    expect(state.repository).not.toHaveBeenCalled();
  });
});
