import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repository = vi.hoisted(() => ({ deleteRun: vi.fn() }));

vi.mock("@/lib/engineering-workflow-repository", () => ({
  deleteAgentRun: repository.deleteRun,
}));

import { DELETE } from "./route";

const runId = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ runId }) };

function request(role = "Admin", orgId = "org-1") {
  return new NextRequest(`http://localhost/api/agent-runs/${runId}`, {
    method: "DELETE",
    headers: {
      origin: "http://localhost",
      "idempotency-key": `delete_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-test-auth": "user",
      "x-test-user-org-id": orgId,
      "x-test-user-role": role,
    },
  });
}

describe("agent run deletion API", () => {
  beforeEach(() => {
    repository.deleteRun.mockReset().mockResolvedValue(undefined);
  });

  it("permanently deletes a tenant-scoped run for an administrator", async () => {
    const response = await DELETE(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(repository.deleteRun).toHaveBeenCalledWith(
      "org-1",
      runId,
      expect.objectContaining({ role: "Admin", orgId: "org-1" }),
    );
    await expect(response.json()).resolves.toEqual({ deleted: true, runId });
  });

  it("rejects contributors before repository mutation", async () => {
    const response = await DELETE(request("Contributor"), context);

    expect(response.status).toBe(403);
    expect(repository.deleteRun).not.toHaveBeenCalled();
  });
});
