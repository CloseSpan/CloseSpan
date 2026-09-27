import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), mode: "postgres" }));
vi.mock("./db", () => ({ databasePool: () => ({ query: mocks.query }), persistenceMode: () => mocks.mode }));
import { getOnboardingDemoWorkspace, needsOnboardingChoice, onboardingAppearanceCookie, onboardingStartedCookie } from "./onboarding-entry";
import { defaultOnboardingState } from "./onboarding-repository";

const setup = { githubConnected: false, feedbackConnected: false, aiConfigured: true, setupComplete: false, feedbackCount: 0, connectedIntegrationIds: [] };

describe("first onboarding choice", () => {
  it("remembers appearance per account without exposing the email in the cookie name", () => {
    expect(onboardingAppearanceCookie("a@example.com")).toBe(onboardingAppearanceCookie("a@example.com"));
    expect(onboardingAppearanceCookie("a@example.com")).not.toBe(onboardingAppearanceCookie("b@example.com"));
    expect(onboardingAppearanceCookie("a@example.com")).not.toContain("a@example.com");
  });
  it("starts with the choice for an untouched workspace", () => {
    expect(needsOnboardingChoice(defaultOnboardingState(), setup, false)).toBe(true);
  });
  it("does not interrupt continued setup or established workspaces", () => {
    expect(needsOnboardingChoice(defaultOnboardingState(), setup, true)).toBe(false);
    expect(needsOnboardingChoice(defaultOnboardingState(), { ...setup, githubConnected: true }, false)).toBe(false);
    expect(needsOnboardingChoice(defaultOnboardingState(), { ...setup, feedbackConnected: true }, false)).toBe(false);
    expect(needsOnboardingChoice(defaultOnboardingState(), { ...setup, feedbackCount: 1 }, false)).toBe(false);
    expect(needsOnboardingChoice({ ...defaultOnboardingState(), phase: "complete" }, setup, false)).toBe(false);
    expect(needsOnboardingChoice({ ...defaultOnboardingState(), messages: [{ role: "user", content: "My product", at: "2026-09-26" }] }, setup, false)).toBe(false);
  });
  it("scopes the setup preference to both the user and workspace", () => {
    expect(onboardingStartedCookie("a@example.com", "org_a")).not.toBe(onboardingStartedCookie("b@example.com", "org_a"));
    expect(onboardingStartedCookie("a@example.com", "org_a")).not.toBe(onboardingStartedCookie("a@example.com", "org_b"));
    expect(onboardingStartedCookie("a@example.com", "org_a")).not.toContain("a@example.com");
  });
});

describe("shareable demo selection", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.mode = "postgres";
    mocks.query.mockReset();
  });
  it("uses only an explicitly marked, enabled presentation demo", async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: "org_demo", name: "CloseSpan Demo" }] });
    expect(await getOnboardingDemoWorkspace()).toEqual({ id: "org_demo", name: "CloseSpan Demo" });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("demoMode'='presentation'"), [null]);
    expect(mocks.query.mock.calls[0][0]).toContain("guide.enabled=true");
  });
  it.each([{ rows: [] }, { rows: [{ id: "a" }, { id: "b" }] }])("does not guess when no unique presentation exists", async ({ rows }) => {
    mocks.query.mockResolvedValue({ rows });
    expect(await getOnboardingDemoWorkspace()).toBeNull();
  });
  it("validates an operator-selected ID against the same presentation contract", async () => {
    vi.stubEnv("ONBOARDING_DEMO_ORG_ID", "org_selected");
    mocks.query.mockResolvedValue({ rows: [] });
    expect(await getOnboardingDemoWorkspace()).toBeNull();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("o.id=$1"), ["org_selected"]);
  });
  it("does not expose the mutable legacy memory demo", async () => {
    mocks.mode = "memory";
    expect(await getOnboardingDemoWorkspace()).toBeNull();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
