import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const repo = vi.hoisted(() => ({ manage: vi.fn() }));
vi.mock("@/lib/platform-user-management", () => ({ managePlatformUser: repo.manage }));
vi.mock("@/lib/presentation-demo", () => ({ readPresentationDemo: vi.fn(async () => null) }));
import { POST } from "./route";

function request({ email = "shanmukhsain@gmail.com", role = "Admin", origin = "http://localhost", body = { email: "person@example.com", action: "block", expectedStatus: "Active" } as unknown, auth = "yes" } = {}) {
  return new NextRequest("http://localhost/api/admin/users", { method: "POST", headers: {
    origin, "Content-Type": "application/json", "idempotency-key": "platform_user_test",
    "x-test-user-email": email, "x-test-user-role": role, "x-test-user-org-id": "org_live", "x-test-auth": auth,
  }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.stubEnv("APP_MODE", "production"); repo.manage.mockReset().mockResolvedValue({ status: "Blocked" }); });
afterEach(() => vi.unstubAllEnvs());

describe("platform user administration API", () => {
  it("authorizes the platform owner, scopes the actor from the session, and returns no-store", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(repo.manage).toHaveBeenCalledWith(expect.objectContaining({ actor: { email: "shanmukhsain@gmail.com", role: "Admin" }, email: "person@example.com" }));
  });
  it.each([{ email: "other@example.com" }, { role: "Viewer" }, { auth: "none" }, { origin: "https://evil.example" }])("rejects unauthorized requests before touching accounts: %j", async (options) => {
    expect((await POST(request(options))).status).toBe(options.auth === "none" ? 401 : 403);
    expect(repo.manage).not.toHaveBeenCalled();
  });
  it.each([null, { email: "wrong", action: "block" }, { email: "person@example.com", action: "makeAdmin", expectedStatus: "Active" }, { email: "person@example.com", action: "block", expectedStatus: "Active", actor: { role: "Admin" } }])("validates payloads: %j", async (body) => {
    expect((await POST(request({ body }))).status).toBe(400);
    expect(repo.manage).not.toHaveBeenCalled();
  });
  it("never exposes database failure details", async () => {
    repo.manage.mockRejectedValue(new Error("sensitive SQL statement"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sensitive SQL");
  });
});
