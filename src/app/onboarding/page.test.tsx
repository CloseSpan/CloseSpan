import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), setup: vi.fn(), onboarding: vi.fn(), cookie: vi.fn() }));
vi.mock("@/lib/auth-user", () => ({ requireWorkspaceUser: mocks.user }));
vi.mock("@/lib/integration-repository", () => ({ getWorkspaceSetupStatus: mocks.setup }));
vi.mock("@/lib/onboarding-repository", async (original) => ({ ...await original<typeof import("@/lib/onboarding-repository")>(), getOnboardingState: mocks.onboarding }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`); } }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/onboarding-agent-panel", () => ({ OnboardingAgentPanel: () => <div>Connect your tools</div> }));
vi.mock("@/components/onboarding-welcome", () => ({ OnboardingWelcome: () => <div>Explore demo · Set up my workspace</div> }));
vi.mock("@/components/onboarding-appearance", () => ({ OnboardingAppearance: () => <div>How should CloseSpan look?</div> }));
import OnboardingPage from "./page";
import { defaultOnboardingState } from "@/lib/onboarding-repository";
import { onboardingAppearanceCookie } from "@/lib/onboarding-entry";

describe("onboarding first screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookie.mockReset();
    mocks.user.mockResolvedValue({ orgId: "org_private", email: "new@example.com", role: "Admin" });
    mocks.setup.mockResolvedValue({ feedbackCount: 0, setupComplete: false, githubConnected: false, feedbackConnected: false });
    mocks.onboarding.mockResolvedValue(defaultOnboardingState());
  });
  it("shows appearance first, before the demo choice or setup agent", async () => {
    const markup = renderToStaticMarkup(await OnboardingPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain("How should CloseSpan look?");
    expect(markup).not.toContain("Explore demo");
    expect(markup).not.toContain("Connect your tools");
  });
  it("shows the demo choice after appearance is completed, including on reload", async () => {
    mocks.cookie.mockImplementation((key) => key === onboardingAppearanceCookie("new@example.com") ? { value: "true" } : undefined);
    const markup = renderToStaticMarkup(await OnboardingPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain("Explore demo");
    expect(markup).not.toContain("How should CloseSpan look?");
    expect(markup).not.toContain("Connect your tools");
  });
  it("resumes setup after the user chooses it", async () => {
    mocks.cookie.mockReturnValue({ value: "true" });
    const markup = renderToStaticMarkup(await OnboardingPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain("Connect your tools");
    expect(markup).not.toContain("Back to welcome");
    expect(markup).not.toContain("Back to home");
    expect(markup).not.toContain("Explore demo");
    expect(markup).not.toContain("How should CloseSpan look?");
  });
  it.each([{ github: "connected" }, { github: "error" }, { discord: "connected" }, { discord: "error" }])("preserves provider callbacks: %j", async (params) => {
    const markup = renderToStaticMarkup(await OnboardingPage({ searchParams: Promise.resolve(params) }));
    expect(markup).toContain("Connect your tools");
    expect(markup).not.toContain("Explore demo");
    expect(markup).not.toContain("How should CloseSpan look?");
  });
  it("does not interrupt an already configured workspace", async () => {
    mocks.onboarding.mockResolvedValue({ ...defaultOnboardingState(), phase: "complete" });
    await expect(OnboardingPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/overview");
  });
  it("lets an existing user explicitly revisit the choice", async () => {
    mocks.cookie.mockReturnValue({ value: "true" });
    mocks.onboarding.mockResolvedValue({ ...defaultOnboardingState(), phase: "complete" });
    const markup = renderToStaticMarkup(await OnboardingPage({ searchParams: Promise.resolve({ step: "welcome" }) }));
    expect(markup).toContain("Explore demo");
  });
  it("lets users revisit appearance without resetting onboarding progress", async () => {
    mocks.cookie.mockReturnValue({ value: "true" });
    mocks.onboarding.mockResolvedValue({ ...defaultOnboardingState(), phase: "complete" });
    const markup = renderToStaticMarkup(await OnboardingPage({ searchParams: Promise.resolve({ step: "appearance" }) }));
    expect(markup).toContain("How should CloseSpan look?");
    expect(markup).not.toContain("Connect your tools");
  });
  it("does not show another account's completed appearance preference", async () => {
    mocks.cookie.mockImplementation((key) => key === onboardingAppearanceCookie("someone@example.com") ? { value: "true" } : undefined);
    const markup = renderToStaticMarkup(await OnboardingPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain("How should CloseSpan look?");
  });
});
