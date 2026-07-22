import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetFeatureRequestStoreForTests } from "@/lib/feature-request-repository";
import { GET, POST as submit } from "../../route";
import { POST as moderate } from "./route";

function request(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      "x-test-client-ip": "203.0.113.70",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function pendingRequest(title: string) {
  const response = await submit(
    request("http://localhost/api/requests", {
      title,
      description: "This request should be reviewed before it is public.",
    }),
  );
  const body = await response.json();
  return body.submission.id as string;
}

beforeEach(() => {
  vi.stubEnv("APP_MODE", "demo");
  vi.stubEnv("PERSISTENCE_MODE", "memory");
  vi.stubEnv(
    "FEATURE_REQUEST_IP_SECRET",
    "test-feature-request-secret-that-is-long-enough",
  );
  resetFeatureRequestStoreForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("feature request moderation API", () => {
  it("publishes an approved request and replays the idempotent decision", async () => {
    const requestId = await pendingRequest("Add executive digest controls");
    const moderationRequest = () =>
      request(
        `http://localhost/api/requests/${requestId}/moderation`,
        { decision: "publish" },
        { "idempotency-key": "moderate_publish_001" },
      );
    const context = { params: Promise.resolve({ requestId }) };

    const response = await moderate(moderationRequest(), context);
    const replay = await moderate(moderationRequest(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      decision: "publish",
      replayed: false,
      request: { id: requestId, status: "Backlog" },
    });
    expect(await replay.json()).toMatchObject({ replayed: true });

    const board = await GET(
      new NextRequest("http://localhost/api/requests", {
        headers: { "x-test-client-ip": "203.0.113.71" },
      }),
    );
    expect((await board.json()).requests).toHaveLength(1);
  });

  it("keeps rejected requests private", async () => {
    const requestId = await pendingRequest("Expose unsafe internal details");
    const response = await moderate(
      request(
        `http://localhost/api/requests/${requestId}/moderation`,
        { decision: "reject" },
        { "idempotency-key": "moderate_reject_001" },
      ),
      { params: Promise.resolve({ requestId }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      decision: "reject",
      request: null,
    });
    const board = await GET(
      new NextRequest("http://localhost/api/requests", {
        headers: { "x-test-client-ip": "203.0.113.72" },
      }),
    );
    expect((await board.json()).requests).toHaveLength(0);
  });

  it("requires an administrator moderator", async () => {
    const requestId = await pendingRequest("Add another workflow option");
    const response = await moderate(
      request(
        `http://localhost/api/requests/${requestId}/moderation`,
        { decision: "publish" },
        {
          "idempotency-key": "moderate_denied_001",
          "x-test-user-role": "Contributor",
        },
      ),
      { params: Promise.resolve({ requestId }) },
    );

    expect(response.status).toBe(403);
  });
});
