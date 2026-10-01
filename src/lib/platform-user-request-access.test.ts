import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const access = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("./auth-user", () => ({ resolveWorkspaceAccess: access.resolve }));
import { authorizeRead, authorizeMutation } from "./request-security";
beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); access.resolve.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
describe("restricted account request authorization", () => {
  it.each(["Blocked", "Deleted"])("rejects reads and mutations from existing %s sessions", async (reason) => {
    access.resolve.mockResolvedValue({ status: "restricted", reason });
    const request = new NextRequest("https://example.com/api/settings", { method: "POST", headers: { origin: "https://example.com", "idempotency-key": "restricted_test" } });
    await expect(authorizeRead(request)).rejects.toMatchObject({ status: 403 });
    await expect(authorizeMutation(request)).rejects.toMatchObject({ status: 403 });
  });
});
