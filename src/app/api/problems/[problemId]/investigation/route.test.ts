import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/request-security";

const repository = vi.hoisted(() => ({ investigate: vi.fn() }));
vi.mock("@/lib/investigation-repository", () => ({
  createAutomatedInvestigationForProblem: repository.investigate,
}));

import { POST } from "./route";

function request(role = "Contributor", orgId?: string) {
  return new NextRequest("http://localhost/api/problems/issue-1/investigation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
      "x-test-user-role": role,
      ...(orgId ? { "x-org-id": orgId } : {}),
    },
  });
}
const params = { params: Promise.resolve({ problemId: "issue-1" }) };

describe("issue investigation route", () => {
  beforeEach(() => {
    process.env.APP_MODE = "demo";
    repository.investigate.mockReset();
  });

  it("starts an eligible investigation in the authenticated workspace", async () => {
    repository.investigate.mockResolvedValue({ created: true, problemId: "issue-1", investigationId: "inv-1", confidence: 0.8, reason: "Created an evidence-bound investigation." });
    const response = await POST(request(), params);
    expect(response.status).toBe(201);
    expect(repository.investigate).toHaveBeenCalledWith("org_northstar", "issue-1");
    expect((await response.json()).error).toBeUndefined();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    "The linked reports are awaiting analysis review.",
    "This issue is closed. Reopen it before starting an investigation.",
    "An investigation already exists for this issue. Refresh the page to view it.",
  ])("preserves the specific eligibility reason: %s", async (reason) => {
    repository.investigate.mockResolvedValue({ created: false, problemId: "issue-1", investigationId: null, confidence: null, reason });
    const response = await POST(request(), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: reason });
  });

  it("returns a tenant-safe not-found response", async () => {
    repository.investigate.mockRejectedValue(new HttpError(404, "This issue was not found in the current workspace."));
    const response = await POST(request(), params);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "This issue was not found in the current workspace." });
  });

  it("retains role and workspace access checks", async () => {
    expect((await POST(request("Viewer"), params)).status).toBe(403);
    expect((await POST(request("Contributor", "org-other"), params)).status).toBe(403);
    expect(repository.investigate).not.toHaveBeenCalled();
  });
});
