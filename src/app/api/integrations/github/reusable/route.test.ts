import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const reuse = vi.hoisted(() => ({ list: vi.fn(), link: vi.fn() }));
const demo = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/presentation-demo", () => ({ readPresentationDemo: demo.read }));
vi.mock("@/lib/github-reusable-installations", () => ({
  listReusableGithubInstallations: reuse.list,
  linkReusableGithubInstallation: reuse.link,
}));

import { GET, POST } from "./route";

function request(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://closespan.com/api/integrations/github/reusable", {
    method,
    headers: {
      "content-type": "application/json",
      "x-test-user-org-id": "target-org",
      "x-test-user-id": "target-admin",
      "x-test-user-email": "admin@example.com",
      "idempotency-key": crypto.randomUUID(),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("reusable GitHub installation API", () => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "production");
    demo.read.mockReset().mockResolvedValue(false);
    reuse.list.mockReset().mockResolvedValue([]);
    reuse.link.mockReset().mockResolvedValue({ linked: true });
  });

  it("blocks presentation workspace connections before linking an installation", async () => {
    demo.read.mockResolvedValue(true);
    const response = await POST(request("POST", { installationId: "150109806" }));

    expect(response.status).toBe(403);
    expect(demo.read).toHaveBeenCalledWith("target-org");
    expect(reuse.link).not.toHaveBeenCalled();
  });

  it("returns Admin-scoped discovery without caching", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ installations: [] });
    expect(reuse.list).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "target-org", actorId: "target-admin", actorEmail: "admin@example.com", role: "Admin",
    }));
  });

  it("requires authentication for discovery", async () => {
    const response = await GET(request("GET", undefined, { "x-test-auth": "none" }));
    expect(response.status).toBe(401);
    expect(reuse.list).not.toHaveBeenCalled();
  });

  it.each(["Contributor", "Viewer"])("rejects %s discovery", async (role) => {
    const response = await GET(request("GET", undefined, { "x-test-user-role": role }));
    expect(response.status).toBe(403);
    expect(reuse.list).not.toHaveBeenCalled();
  });

  it("rejects cross-workspace reads", async () => {
    const response = await GET(request("GET", undefined, { "x-org-id": "someone-else" }));
    expect(response.status).toBe(403);
    expect(reuse.list).not.toHaveBeenCalled();
  });

  it("links only the explicit installation using authenticated context", async () => {
    const response = await POST(request("POST", { installationId: "150109806", orgId: "ignored-org" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ linked: true });
    expect(reuse.link).toHaveBeenCalledWith(expect.objectContaining({ orgId: "target-org" }), "150109806");
  });

  it("rejects non-Admin linking", async () => {
    const response = await POST(request("POST", { installationId: "150109806" }, { "x-test-user-role": "Contributor" }));
    expect(response.status).toBe(403);
    expect(reuse.link).not.toHaveBeenCalled();
  });

  it("rejects cross-origin linking", async () => {
    const response = await POST(request("POST", { installationId: "150109806" }, { origin: "https://attacker.example" }));
    expect(response.status).toBe(403);
    expect(reuse.link).not.toHaveBeenCalled();
  });

  it("rejects linking without an idempotency key", async () => {
    const response = await POST(request("POST", { installationId: "150109806" }, { "idempotency-key": "" }));
    expect(response.status).toBe(400);
    expect(reuse.link).not.toHaveBeenCalled();
  });

  it.each([null, {}, { installationId: 123 }])("rejects malformed input %j", async (body) => {
    const response = await POST(request("POST", body));
    expect(response.status).toBe(400);
    expect(reuse.link).not.toHaveBeenCalled();
  });

  it("does not expose provider or database errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reuse.link.mockRejectedValue(new Error("private database connection details"));
    const response = await POST(request("POST", { installationId: "150109806" }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database");
    log.mockRestore();
  });
});
