import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createEmptyOverviewAnalytics } from "@/lib/overview-analytics";

const state = vi.hoisted(() => ({ getOverviewAnalytics: vi.fn(), requireWorkspaceUser: vi.fn() }));
vi.mock("@/lib/auth-user", () => ({ requireWorkspaceUser: state.requireWorkspaceUser }));
vi.mock("@/lib/overview-repository", () => ({ getOverviewAnalytics: state.getOverviewAnalytics }));
vi.mock("@/components/screens", () => ({
  ProblemsScreen: ({ analytics }: { analytics: { problems: unknown[] } }) =>
    <section data-screen="production-problems">{analytics.problems.length} issues</section>,
}));

import Page from "./page";

describe("issues route", () => {
  it("loads the signed-in workspace into the production problem screen", async () => {
    state.requireWorkspaceUser.mockResolvedValue({ orgId: "org-current" });
    state.getOverviewAnalytics.mockResolvedValue(createEmptyOverviewAnalytics());
    const markup = renderToStaticMarkup(await Page());
    expect(state.getOverviewAnalytics).toHaveBeenCalledWith("org-current");
    expect(markup).toContain('data-screen="production-problems"');
    expect(markup).toContain("0 issues");
  });
});
