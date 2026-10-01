import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({ disconnect: vi.fn() }));
vi.mock("@/lib/integration-repository", () => ({
  createWebhookIntegration: vi.fn(),
  disconnectWebhookIntegration: repository.disconnect,
}));
import { DELETE } from "./route";

function request(role = "Admin") {
  return new NextRequest("http://localhost/api/integrations/webhook", {
    method: "DELETE",
    headers: {
      "idempotency-key": "webhook_disconnect_test",
      "x-test-user-id": "admin_1",
      "x-test-user-org-id": "org_alpha",
      "x-test-user-role": role,
    },
  });
}

describe("webhook disconnection", () => {
  beforeEach(() => {
    process.env.APP_MODE = "demo";
    repository.disconnect.mockReset().mockResolvedValue(undefined);
  });
  it("disconnects only the authenticated workspace and never caches the response", async () => {
    const response = await DELETE(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ disconnected: true });
    expect(repository.disconnect).toHaveBeenCalledWith("org_alpha", "admin_1");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("requires administrator authorization", async () => {
    const response = await DELETE(request("Viewer"));
    expect(response.status).toBe(403);
    expect(repository.disconnect).not.toHaveBeenCalled();
  });
  it("does not claim success on storage failure", async () => {
    repository.disconnect.mockRejectedValue(new Error("Storage unavailable"));
    const response = await DELETE(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Storage unavailable" });
  });
});
