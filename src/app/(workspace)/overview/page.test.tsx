import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyOverviewAnalytics } from "@/lib/overview-analytics";

const state = vi.hoisted(() => ({
  analytics: vi.fn(), setup: vi.fn(), onboarding: vi.fn(), user: vi.fn(),
  redirect: vi.fn((href: string) => { throw new Error(`redirect:${href}`); }),
}));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("@/lib/auth-user", () => ({ requireWorkspaceUser: state.user, displayFirstName: (name: string) => name.split(" ")[0] }));
vi.mock("@/lib/overview-repository", () => ({ getOverviewAnalytics: state.analytics }));
vi.mock("@/lib/integration-repository", () => ({ getWorkspaceSetupStatus: state.setup }));
vi.mock("@/lib/onboarding-repository", () => ({ getOnboardingState: state.onboarding }));
vi.mock("@/components/screens", () => ({
  OverviewScreen: ({ firstName, organizationName }: { firstName: string; organizationName: string }) =>
    <section data-screen="production-overview">{firstName} · {organizationName}</section>,
}));

import OverviewPage from "./page";

describe("production overview entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user.mockResolvedValue({ orgId: "org-current", name: "Sam Example", organizationName: "Demo" });
    state.analytics.mockResolvedValue(createEmptyOverviewAnalytics());
    state.setup.mockResolvedValue({ setupComplete: true, feedbackCount: 2 });
    state.onboarding.mockResolvedValue({ phase: "complete" });
  });

  it("renders the real overview instead of redirecting to issues", async () => {
    const markup = renderToStaticMarkup(await OverviewPage());
    expect(markup).toContain('data-screen="production-overview"');
    expect(markup).toContain("Sam · Demo");
    for (const read of [state.analytics, state.setup, state.onboarding]) {
      expect(read).toHaveBeenCalledWith("org-current");
    }
    expect(state.redirect).not.toHaveBeenCalled();
  });

  it("preserves the production setup guard for a new workspace", async () => {
    state.setup.mockResolvedValue({ setupComplete: false, feedbackCount: 0 });
    state.onboarding.mockResolvedValue({ phase: "github" });
    await expect(OverviewPage()).rejects.toThrow("redirect:/onboarding");
  });
});
