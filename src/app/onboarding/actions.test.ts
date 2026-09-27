import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(), demo: vi.fn(), set: vi.fn(), remove: vi.fn(), revalidate: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.set, delete: mocks.remove }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth-user", () => ({ requireWorkspaceUser: mocks.user, ACTIVE_ORGANIZATION_COOKIE: "active_org", LEGACY_ACTIVE_ORGANIZATION_COOKIE: "legacy_org", activeOrganizationCookieOptions: () => ({ httpOnly: true, sameSite: "lax", path: "/" }) }));
vi.mock("@/lib/onboarding-entry", async (original) => ({ ...await original<typeof import("@/lib/onboarding-entry")>(), getOnboardingDemoWorkspace: mocks.demo }));
import { completeOnboardingAppearanceAction, continueOnboardingAction, exploreDemoAction } from "./actions";
import { DEMO_RETURN_COOKIE, DEMO_SESSION_COOKIE, demoSessionCookieValue, onboardingAppearanceCookie, onboardingStartedCookie } from "@/lib/onboarding-entry";

const user = { orgId: "org_private", email: "new@example.com", organizations: [{ id: "org_private" }] };
describe("onboarding entry actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.set.mockReset();
    mocks.user.mockResolvedValue(user);
    mocks.demo.mockResolvedValue({ id: "org_demo", name: "CloseSpan Demo" });
  });
  it("remembers the appearance step without changing workspace or starting setup", async () => {
    await expect(completeOnboardingAppearanceAction()).rejects.toThrow("redirect:/onboarding?step=welcome");
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith(onboardingAppearanceCookie(user.email), "true", expect.objectContaining({ httpOnly: true, maxAge: 31536000 }));
    expect(mocks.demo).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("requires authentication before recording appearance completion", async () => {
    mocks.user.mockRejectedValue(new Error("redirect:/login"));
    await expect(completeOnboardingAppearanceAction()).rejects.toThrow("redirect:/login");
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("offers a retry if appearance progress cannot be saved", async () => {
    mocks.set.mockImplementation(() => { throw new Error("Cookies unavailable"); });
    expect((await completeOnboardingAppearanceAction()).error).toContain("try again");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("enters the trusted demo and remembers the user's own workspace without marking it complete", async () => {
    await expect(exploreDemoAction()).rejects.toThrow("redirect:/overview");
    expect(mocks.set).toHaveBeenCalledWith(DEMO_SESSION_COOKIE, demoSessionCookieValue(user.email, "org_demo"), expect.objectContaining({ httpOnly: true }));
    expect(mocks.set).toHaveBeenCalledWith(DEMO_RETURN_COOKIE, "org_private", expect.any(Object));
    expect(mocks.set).toHaveBeenCalledWith("active_org", "org_demo", expect.any(Object));
    expect(mocks.set).not.toHaveBeenCalledWith(onboardingStartedCookie(user.email, user.orgId), expect.anything(), expect.anything());
  });
  it("shows a recoverable error without changing workspace when the demo is unavailable", async () => {
    mocks.demo.mockResolvedValue(null);
    expect((await exploreDemoAction()).error).toContain("temporarily unavailable");
    expect(mocks.set).not.toHaveBeenCalled();
    mocks.demo.mockRejectedValue(new Error("offline"));
    expect((await exploreDemoAction()).error).toContain("Try again");
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("requires authentication before looking up the demo", async () => {
    mocks.user.mockRejectedValue(new Error("redirect:/login"));
    await expect(exploreDemoAction()).rejects.toThrow("redirect:/login");
    expect(mocks.demo).not.toHaveBeenCalled();
  });
  it("continues the normal onboarding flow and remembers the choice", async () => {
    await expect(continueOnboardingAction()).rejects.toThrow("redirect:/onboarding");
    expect(mocks.set).toHaveBeenCalledWith(onboardingStartedCookie(user.email, user.orgId), "true", expect.any(Object));
    expect(mocks.set).toHaveBeenCalledWith("active_org", "org_private", expect.any(Object));
  });
  it("leaves the demo for the authenticated return membership, clearing demo mode", async () => {
    mocks.user.mockResolvedValue({ ...user, orgId: "org_demo", demoSession: { returnOrgId: "org_private" } });
    await expect(continueOnboardingAction()).rejects.toThrow("redirect:/onboarding");
    expect(mocks.set).toHaveBeenCalledWith("active_org", "org_private", expect.any(Object));
    expect(mocks.remove).toHaveBeenCalledWith(DEMO_SESSION_COOKIE);
    expect(mocks.remove).toHaveBeenCalledWith(DEMO_RETURN_COOKIE);
  });
  it("refuses a return target outside the authenticated memberships", async () => {
    mocks.user.mockResolvedValue({ ...user, demoSession: { returnOrgId: "org_someone_else" } });
    await expect(continueOnboardingAction()).rejects.toThrow("Workspace access is not available");
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
