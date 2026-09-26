import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeAdminMutation,
  authorizeAdminRead,
  authorizeMutation,
  authorizeRead,
} from "./request-security";

const demo = vi.hoisted(() => ({ read: vi.fn<() => Promise<boolean>>() }));

vi.mock("./presentation-demo", () => ({ readPresentationDemo: demo.read }));

function request(path = "/api/settings/policy", headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "idempotency-key": "demo-guard-request",
      "x-test-user-org-id": "org_presentation_test",
      ...headers,
    },
  });
}

beforeEach(() => {
  demo.read.mockReset().mockResolvedValue(false);
  vi.stubEnv("APP_MODE", "production");
});

afterEach(() => vi.unstubAllEnvs());

describe("presentation workspace mutation protection", () => {
  it.each([
    "/api/agent-execution/tenki/test",
    "/api/agent-execution/createos/test",
    "/api/settings/policy",
    "/api/final-execution-approvals/demo-approval/approve",
    "/api/engineering-approvals/demo-approval/approve",
    "/api/integrations/slack/install",
  ])("rejects a direct mutation to %s in a presentation workspace", async (path) => {
    demo.read.mockResolvedValue(true);

    await expect(authorizeAdminMutation(request(path))).rejects.toMatchObject({
      status: 403,
      message: "This demo workspace is read-only. Switch to a live workspace to take actions.",
    });
    expect(demo.read).toHaveBeenCalledWith("org_presentation_test");
  });

  it("also rejects contributor mutations in a presentation workspace", async () => {
    demo.read.mockResolvedValue(true);

    await expect(authorizeMutation(request("/api/ai/analyze", {
      "x-test-user-role": "Contributor",
    }))).rejects.toMatchObject({ status: 403 });
  });

  it("preserves normal live workspace mutation authorization", async () => {
    await expect(authorizeAdminMutation(request())).resolves.toMatchObject({
      orgId: "org_presentation_test",
      role: "Admin",
      idempotencyKey: "demo-guard-request",
    });
  });

  it("keeps presentation reads available without querying the mutation guard", async () => {
    demo.read.mockResolvedValue(true);

    await expect(authorizeRead(request())).resolves.toMatchObject({
      orgId: "org_presentation_test",
    });
    await expect(authorizeAdminRead(request())).resolves.toMatchObject({
      role: "Admin",
    });
    expect(demo.read).not.toHaveBeenCalled();
  });

  it("fails closed if presentation status cannot be read", async () => {
    demo.read.mockRejectedValue(new Error("Workspace status unavailable"));

    await expect(authorizeMutation(request())).rejects.toThrow("Workspace status unavailable");
  });

  it("does not trust an organization header to bypass the presentation gate", async () => {
    await expect(authorizeMutation(request("/api/settings/policy", {
      "x-org-id": "org_other_workspace",
    }))).rejects.toMatchObject({ status: 403, message: "Organization scope is invalid" });
    expect(demo.read).not.toHaveBeenCalled();
  });

  it("retains authentication, role, and idempotency requirements before checking demo status", async () => {
    await expect(authorizeMutation(request("/api/settings/policy", {
      "x-test-auth": "none",
    }))).rejects.toMatchObject({ status: 401 });
    await expect(authorizeMutation(request("/api/settings/policy", {
      "x-test-user-role": "Viewer",
    }))).rejects.toMatchObject({ status: 403 });
    await expect(authorizeMutation(request("/api/settings/policy", {
      "idempotency-key": "bad",
    }))).rejects.toMatchObject({ status: 400 });
    expect(demo.read).not.toHaveBeenCalled();
  });
});
