import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repository = vi.hoisted(() => ({ reset: vi.fn() }));

vi.mock("@/lib/demo-guide-repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/demo-guide-repository")>();
  return { ...original, resetWorkspaceDemoWorkflow: repository.reset };
});

import { POST } from "./route";

function request(options: { role?: string; orgId?: string } = {}) {
  return new NextRequest("http://localhost/api/demo/reset", {
    method: "POST",
    headers: {
      "idempotency-key": `demo_${crypto.randomUUID()}`,
      "x-test-user-role": options.role ?? "Admin",
      ...(options.orgId ? { "x-org-id": options.orgId } : {}),
    },
  });
}

describe("guided demo reset route", () => {
  beforeEach(() => {
    process.env.APP_MODE = "demo";
    repository.reset.mockReset().mockResolvedValue({
      problemId: "prob_demo_export",
      approvalId: "apr_demo_export",
    });
  });

  it("resets only the authenticated administrator workspace", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(repository.reset).toHaveBeenCalledWith("org_northstar");
    expect(await response.json()).toEqual({
      reset: true,
      problemId: "prob_demo_export",
      approvalId: "apr_demo_export",
    });
  });

  it("rejects non-admins and conflicting organization headers", async () => {
    expect((await POST(request({ role: "Contributor" }))).status).toBe(403);
    expect((await POST(request({ orgId: "org_other" }))).status).toBe(403);
    expect(repository.reset).not.toHaveBeenCalled();
  });

  it("returns a safe unavailable response when the workspace has no guide", async () => {
    repository.reset.mockRejectedValue(new Error("Guided demo is not enabled"));
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Guided demo is unavailable." });
  });
});
