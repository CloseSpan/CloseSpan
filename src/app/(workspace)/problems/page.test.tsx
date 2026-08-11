import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOverviewAnalytics: vi.fn(),
  getWorkspaceData: vi.fn(),
  requireWorkspaceUser: vi.fn(),
}));

vi.mock("@/lib/auth-user", () => ({
  requireWorkspaceUser: mocks.requireWorkspaceUser,
}));

vi.mock("@/lib/overview-repository", () => ({
  getOverviewAnalytics: mocks.getOverviewAnalytics,
}));

vi.mock("@/lib/workspace-repository", () => ({
  getWorkspaceData: mocks.getWorkspaceData,
}));

vi.mock("@/components/screens", () => ({
  ProblemsScreen: () => null,
}));

import Page from "./page";

describe("Product problems page", () => {
  beforeEach(() => {
    mocks.getOverviewAnalytics.mockReset();
    mocks.getWorkspaceData.mockReset();
    mocks.requireWorkspaceUser.mockReset();
  });

  it("loads only the analytics required by the problems screen", async () => {
    const analytics = { problems: [] };
    mocks.requireWorkspaceUser.mockResolvedValue({ orgId: "org_test" });
    mocks.getOverviewAnalytics.mockResolvedValue(analytics);

    const result = await Page();

    expect(mocks.getOverviewAnalytics).toHaveBeenCalledWith("org_test");
    expect(mocks.getWorkspaceData).not.toHaveBeenCalled();
    expect(result.props.analytics).toBe(analytics);
  });
});
