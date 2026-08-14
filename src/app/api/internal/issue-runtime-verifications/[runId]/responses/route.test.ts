import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

describe("runtime verifier Responses proxy request bounds", () => {
  it("allows a bounded long-running conversation below four megabytes", async () => {
    const response = await POST(
      new NextRequest(
        "https://app.closespan.com/api/internal/issue-runtime-verifications/11111111-1111-4111-8111-111111111111/responses",
        {
          method: "POST",
          headers: {
            "content-length": "3999999",
            "content-type": "application/json",
          },
          body: "{}",
        },
      ),
      { params: Promise.resolve({ runId: "11111111-1111-4111-8111-111111111111" }) },
    );

    expect(response.status).not.toBe(413);
  });

  it("rejects a conversation above the serverless-safe envelope", async () => {
    const response = await POST(
      new NextRequest(
        "https://app.closespan.com/api/internal/issue-runtime-verifications/11111111-1111-4111-8111-111111111111/responses",
        {
          method: "POST",
          headers: {
            "content-length": "4000001",
            "content-type": "application/json",
          },
          body: "{}",
        },
      ),
      { params: Promise.resolve({ runId: "11111111-1111-4111-8111-111111111111" }) },
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Runtime verifier model request is too large",
    });
  });
});
