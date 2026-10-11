import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/agent-run-findings-repository", () => ({ createFindingIssue: mock.create }));
import { POST } from "./route";
function request(role = "Admin", org = "org_alpha", origin = "http://localhost") {
  return new NextRequest("http://localhost/api/agent-runs/findings/test/issue", { method: "POST", headers: {
    origin, "idempotency-key": crypto.randomUUID(), "x-test-auth": "user", "x-test-user-org-id": "org_alpha", "x-test-user-role": role, "x-org-id": org,
  } });
}
const params = { params: Promise.resolve({ fingerprint: "a".repeat(64) }) };
beforeEach(() => { mock.create.mockReset().mockResolvedValue({ problemId: "p1", created: true }); });
describe("finding issue permissions", () => {
  it("uses authenticated workspace context", async () => {
    expect((await POST(request(), params)).status).toBe(200);
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org_alpha", role: "Admin" }), "a".repeat(64));
  });
  it("rejects non-admin creation", async () => { expect((await POST(request("Member"), params)).status).toBe(403); expect(mock.create).not.toHaveBeenCalled(); });
  it("rejects a different requested organization", async () => { expect((await POST(request("Admin", "org_other"), params)).status).toBe(403); expect(mock.create).not.toHaveBeenCalled(); });
  it("rejects cross-origin writes", async () => { expect((await POST(request("Admin", "org_alpha", "https://untrusted.example"), params)).status).toBe(403); expect(mock.create).not.toHaveBeenCalled(); });
});
