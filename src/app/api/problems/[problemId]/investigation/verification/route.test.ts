import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const investigation = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock("@/lib/investigation-repository", () => ({
  recordInvestigationVerification: investigation.record,
}));

import { POST } from "./route";

const problemId = "problem-1";
const context = { params: Promise.resolve({ problemId }) };

function request(body: string | object, role = "Contributor") {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new NextRequest(
    `http://localhost/api/problems/${problemId}/investigation/verification`,
    {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(payload).byteLength),
        "idempotency-key": `verification_${crypto.randomUUID().replaceAll("-", "")}`,
        "x-test-auth": "user",
        "x-test-user-org-id": "org-1",
        "x-test-user-role": role,
      },
      body: payload,
    },
  );
}

describe("investigation verification API", () => {
  beforeEach(() => {
    investigation.record.mockReset().mockResolvedValue(undefined);
  });

  it("records tenant-scoped current-product evidence", async () => {
    const response = await POST(request({
      status: "Confirmed current",
      method: "Product reproduction",
      summary: "Reproduced in the current production build with the linked customer steps.",
    }), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(investigation.record).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      problemId,
      status: "Confirmed current",
      method: "Product reproduction",
    }));
    await expect(response.json()).resolves.toEqual({ recorded: true });
  });

  it("rejects malformed and oversized evidence before repository mutation", async () => {
    const malformed = await POST(request("{"), context);
    expect(malformed.status).toBe(400);

    const oversized = await POST(request({ summary: "x".repeat(4_100) }), context);
    expect(oversized.status).toBe(413);
    expect(investigation.record).not.toHaveBeenCalled();
  });
});
