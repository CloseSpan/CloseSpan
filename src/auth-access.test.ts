import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ status: vi.fn(), activity: vi.fn(), config: null as unknown }));
vi.mock("next-auth", () => ({ default: (config: unknown) => { auth.config = config; return {}; } }));
vi.mock("./lib/auth-user", () => ({ normalizeEmail: (email: string) => email.trim().toLowerCase() }));
vi.mock("./lib/platform-user-access", () => ({ readPlatformUserStatus: auth.status }));
vi.mock("./lib/active-user-repository", () => ({ recordPlatformUserSignIn: auth.activity }));
import "./auth";
const config = () => auth.config as { callbacks: { signIn: (input: unknown) => Promise<boolean | string> } };
const login = { account: { provider: "google" }, profile: { email: "member@example.com", email_verified: true, name: "Member" } };
beforeEach(() => { auth.status.mockReset().mockResolvedValue("Active"); auth.activity.mockReset().mockResolvedValue(undefined); });
describe("sign-in account restrictions", () => {
  it.each(["Blocked", "Deleted"])("denies %s accounts before recording activity", async (status) => {
    auth.status.mockResolvedValue(status);
    await expect(config().callbacks.signIn(login)).resolves.toBe(`/login?error=Account${status}`);
    expect(auth.activity).not.toHaveBeenCalled();
  });
  it("denies sign-in if access status cannot be verified", async () => {
    auth.status.mockRejectedValue(new Error("offline"));
    await expect(config().callbacks.signIn(login)).resolves.toBe("/login?error=AccountAccessUnavailable");
    expect(auth.activity).not.toHaveBeenCalled();
  });
  it("permits verified active Google users", async () => {
    await expect(config().callbacks.signIn(login)).resolves.toBe(true);
    expect(auth.activity).toHaveBeenCalledOnce();
  });
  it("still refuses unverified Google identities", async () => {
    await expect(config().callbacks.signIn({ ...login, profile: { ...login.profile, email_verified: false } })).resolves.toBe(false);
    expect(auth.status).not.toHaveBeenCalled();
  });
});
