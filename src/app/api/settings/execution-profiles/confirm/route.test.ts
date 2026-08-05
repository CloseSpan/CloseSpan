import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const profiles = vi.hoisted(() => ({ confirm: vi.fn(), list: vi.fn() }));
const matches = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/lib/execution-profile-repository", () => ({
  confirmDetectedExecutionProfile: profiles.confirm,
  listExecutionProfileSettings: profiles.list,
}));
vi.mock("@/lib/problem-repository-match-repository", () => ({
  refreshPendingProblemRepositoryMatches: matches.refresh,
}));

import { POST } from "./route";

function request(role = "Admin") {
  return new NextRequest("http://localhost/api/settings/execution-profiles/confirm", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "idempotency-key": `confirm_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-test-auth": "user",
      "x-test-user-org-id": "org-1",
      "x-test-user-role": role,
    },
    body: JSON.stringify({ detectedProfileId: "11111111-1111-4111-8111-111111111111" }),
  });
}

describe("execution profile confirmation API", () => {
  beforeEach(() => {
    profiles.confirm.mockReset().mockResolvedValue({ id: "confirmed" });
    profiles.list.mockReset().mockResolvedValue({ assignments: [] });
    matches.refresh.mockReset().mockResolvedValue([]);
  });

  it("promotes a reviewed suggestion to a new immutable version", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(profiles.confirm).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      detectedProfileId: "11111111-1111-4111-8111-111111111111",
    }));
    expect(matches.refresh).toHaveBeenCalledWith("org-1");
  });

  it("requires an administrator", async () => {
    expect((await POST(request("Contributor"))).status).toBe(403);
    expect(profiles.confirm).not.toHaveBeenCalled();
  });
});
