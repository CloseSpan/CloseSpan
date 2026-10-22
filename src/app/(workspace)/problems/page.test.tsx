import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyOverviewAnalytics } from "@/lib/overview-analytics";

const state = vi.hoisted(() => ({
  getOverviewAnalytics: vi.fn(), requireWorkspaceUser: vi.fn(), readIssueReviewStates: vi.fn(),
  setup: vi.fn(async () => ({ setupComplete: true, feedbackCount: 2 })), onboarding: vi.fn(async () => ({ phase: "complete" })),
  redirect: vi.fn((href: string) => { throw new Error(`redirect:${href}`); }),
}));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("@/lib/integration-repository", () => ({ getWorkspaceSetupStatus: state.setup }));
vi.mock("@/lib/onboarding-repository", () => ({ getOnboardingState: state.onboarding }));
vi.mock("@/lib/auth-user", () => ({ requireWorkspaceUser: state.requireWorkspaceUser }));
vi.mock("@/lib/overview-repository", () => ({ getOverviewAnalytics: state.getOverviewAnalytics }));
vi.mock("@/lib/issue-review-repository", () => ({ readIssueReviewStates: state.readIssueReviewStates }));
vi.mock("@/components/screens", () => ({
  ProblemsScreen: ({ analytics }: { analytics: { problems: Array<{ id: string; reviewState: string | null }> } }) =>
    <section data-screen="production-problems">{analytics.problems.length} issues{analytics.problems.map((p) => <span key={p.id}>{p.id}:{p.reviewState ?? "none"}</span>)}</section>,
}));

import Page from "./page";

describe("issues route", () => {
  beforeEach(() => {
    state.setup.mockResolvedValue({ setupComplete: true, feedbackCount: 2 });
    state.onboarding.mockResolvedValue({ phase: "complete" });
  });
  it("starts onboarding for a new workspace, since Issues is the home page", async () => {
    state.requireWorkspaceUser.mockResolvedValue({ orgId: "org-current" });
    state.getOverviewAnalytics.mockResolvedValue(createEmptyOverviewAnalytics());
    state.readIssueReviewStates.mockResolvedValue({});
    state.setup.mockResolvedValue({ setupComplete: false, feedbackCount: 0 });
    state.onboarding.mockResolvedValue({ phase: "github" });
    await expect(Page()).rejects.toThrow("redirect:/onboarding");
    expect(state.setup).toHaveBeenCalledWith("org-current");
  });
  it("loads the signed-in workspace into the production problem screen", async () => {
    state.requireWorkspaceUser.mockResolvedValue({ orgId: "org-current" });
    state.getOverviewAnalytics.mockResolvedValue(createEmptyOverviewAnalytics());
    state.readIssueReviewStates.mockResolvedValue({});
    const markup = renderToStaticMarkup(await Page());
    expect(state.getOverviewAnalytics).toHaveBeenCalledWith("org-current");
    expect(state.readIssueReviewStates).toHaveBeenCalledWith("org-current");
    expect(markup).toContain('data-screen="production-problems"');
    expect(markup).toContain("0 issues");
  });
  it("attaches current review state only to issues in the signed-in workspace", async () => {
    state.requireWorkspaceUser.mockResolvedValue({ orgId: "org-current" });
    state.getOverviewAnalytics.mockResolvedValue({ ...createEmptyOverviewAnalytics(), problems: [{ id: "one" }, { id: "two" }] });
    state.readIssueReviewStates.mockResolvedValue({ one: "needed", outside: "attention" });
    const markup = renderToStaticMarkup(await Page());
    expect(markup).toContain("one:needed");
    expect(markup).toContain("two:none");
    expect(markup).not.toContain("outside");
  });
});
