import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { HttpError } from "@/lib/request-security";

const turnstile = vi.hoisted(() => ({ verify: vi.fn() }));

vi.mock("@/lib/turnstile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/turnstile")>();
  return { ...actual, verifyTurnstileToken: turnstile.verify };
});

import {
  publishFeatureRequestForTests,
  resetFeatureRequestStoreForTests,
} from "@/lib/feature-request-repository";
import { GET, POST } from "./route";
import { POST as vote } from "./[requestId]/vote/route";

function publicRequest(
  url: string,
  options: {
    method?: "GET" | "POST";
    ip?: string;
    origin?: string;
    body?: unknown;
  } = {},
) {
  const method = options.method ?? "GET";
  return new NextRequest(url, {
    method,
    headers: {
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      ...(options.origin === undefined
        ? { Origin: "http://localhost" }
        : options.origin
          ? { Origin: options.origin }
          : {}),
      "x-test-client-ip": options.ip ?? "203.0.113.10",
    },
    ...(method === "POST"
      ? {
          body: JSON.stringify(
            options.body ?? { turnstileToken: "test-turnstile-token" },
          ),
        }
      : {}),
  });
}

async function create(
  title: string,
  ip = "203.0.113.10",
  description = "This workflow improvement would save our team time.",
) {
  const response = await POST(
    publicRequest("http://localhost/api/requests", {
      method: "POST",
      ip,
      body: { title, description, turnstileToken: "test-turnstile-token" },
    }),
  );
  const body = await response.json();
  return { response, body };
}

async function createPublished(title: string, ip = "203.0.113.10") {
  const created = await create(title, ip);
  const requestId = created.body.submission.id as string;
  publishFeatureRequestForTests(requestId);
  return { ...created, requestId };
}

beforeEach(() => {
  vi.stubEnv("APP_MODE", "demo");
  vi.stubEnv("PERSISTENCE_MODE", "memory");
  vi.stubEnv(
    "FEATURE_REQUEST_IP_SECRET",
    "test-feature-request-secret-that-is-long-enough",
  );
  resetFeatureRequestStoreForTests();
  turnstile.verify.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public feature requests API", () => {
  it("holds a submitted request for moderation before publishing it", async () => {
    const created = await create("Add account-level impact filters");

    expect(created.response.status).toBe(202);
    expect(created.body.submission).toMatchObject({
      title: "Add account-level impact filters",
      moderationStatus: "Pending review",
    });

    const pendingBoard = await GET(
      publicRequest("http://localhost/api/requests", {
        ip: "203.0.113.10",
      }),
    );
    expect((await pendingBoard.json()).requests).toHaveLength(0);

    publishFeatureRequestForTests(created.body.submission.id as string);
    const board = await GET(
      publicRequest("http://localhost/api/requests", {
        ip: "203.0.113.10",
      }),
    );
    expect(board.status).toBe(200);
    expect((await board.json()).requests).toHaveLength(1);
    expect(board.headers.get("Cache-Control")).toContain("no-store");
  });

  it("requires and verifies a Turnstile token before accepting a submission", async () => {
    const missing = await POST(
      publicRequest("http://localhost/api/requests", {
        method: "POST",
        body: {
          title: "Protect the public request form",
          description: "Reject automated submissions before storing them.",
        },
      }),
    );

    expect(missing.status).toBe(400);
    expect(turnstile.verify).not.toHaveBeenCalled();

    turnstile.verify.mockRejectedValueOnce(
      new HttpError(403, "Security verification failed. Try again."),
    );
    const rejected = await create("Reject an invalid challenge");

    expect(rejected.response.status).toBe(403);
    expect(turnstile.verify).toHaveBeenCalledWith(
      "test-turnstile-token",
      "feature_request_submit",
      "203.0.113.10",
    );

    const board = await GET(
      publicRequest("http://localhost/api/requests", {
        ip: "203.0.113.10",
      }),
    );
    expect((await board.json()).requests).toHaveLength(0);
  });

  it("counts only one vote for the same IP and request", async () => {
    const created = await createPublished("Show release verification trends");
    const requestId = created.requestId;
    const context = { params: Promise.resolve({ requestId }) };

    const first = await vote(
      publicRequest(`http://localhost/api/requests/${requestId}/vote`, {
        method: "POST",
        ip: "203.0.113.11",
      }),
      context,
    );
    const replay = await vote(
      publicRequest(`http://localhost/api/requests/${requestId}/vote`, {
        method: "POST",
        ip: "203.0.113.11",
      }),
      context,
    );

    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      status: "recorded",
      voteCount: 1,
      viewerHasVoted: true,
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      status: "already_voted",
      voteCount: 1,
      viewerHasVoted: true,
    });
    expect(turnstile.verify).toHaveBeenCalledWith(
      "test-turnstile-token",
      "feature_request_vote",
      "203.0.113.11",
    );
  });

  it("does not expose pending requests through the vote endpoint", async () => {
    const created = await create("Keep private submissions off the roadmap");
    const requestId = created.body.submission.id as string;
    const response = await vote(
      publicRequest(`http://localhost/api/requests/${requestId}/vote`, {
        method: "POST",
        ip: "203.0.113.14",
      }),
      { params: Promise.resolve({ requestId }) },
    );

    expect(response.status).toBe(404);
  });

  it("does not record a vote when Turnstile rejects the token", async () => {
    const created = await createPublished("Verify voters before recording");
    turnstile.verify.mockRejectedValueOnce(
      new HttpError(403, "Security verification failed. Try again."),
    );

    const response = await vote(
      publicRequest(
        `http://localhost/api/requests/${created.requestId}/vote`,
        { method: "POST", ip: "203.0.113.31" },
      ),
      { params: Promise.resolve({ requestId: created.requestId }) },
    );

    expect(response.status).toBe(403);
    const board = await GET(
      publicRequest("http://localhost/api/requests", {
        ip: "203.0.113.31",
      }),
    );
    expect((await board.json()).requests[0].voteCount).toBe(0);
  });

  it("rate-limits repeated vote attempts across the shared store", async () => {
    const created = await createPublished("Protect public voting capacity");
    const context = { params: Promise.resolve({ requestId: created.requestId }) };
    let response: Response | undefined;
    for (let attempt = 0; attempt < 61; attempt += 1) {
      response = await vote(
        publicRequest(
          `http://localhost/api/requests/${created.requestId}/vote`,
          { method: "POST", ip: "203.0.113.15" },
        ),
        context,
      );
    }

    expect(response?.status).toBe(429);
  });

  it("allows the same IP to vote once on different requests", async () => {
    const firstRequest = await createPublished("First roadmap request");
    const secondRequest = await createPublished("Second roadmap request");
    const ip = "203.0.113.19";

    for (const requestId of [
      firstRequest.requestId,
      secondRequest.requestId,
    ]) {
      const response = await vote(
        publicRequest(`http://localhost/api/requests/${requestId}/vote`, {
          method: "POST",
          ip,
        }),
        { params: Promise.resolve({ requestId }) },
      );
      expect(response.status).toBe(201);
      expect((await response.json()).voteCount).toBe(1);
    }
  });

  it("marks only the current viewer's recorded votes", async () => {
    const created = await createPublished("Expose connector sync diagnostics");
    const requestId = created.requestId;
    await vote(
      publicRequest(`http://localhost/api/requests/${requestId}/vote`, {
        method: "POST",
        ip: "203.0.113.21",
      }),
      { params: Promise.resolve({ requestId }) },
    );

    const votedBoard = await GET(
      publicRequest("http://localhost/api/requests", {
        ip: "203.0.113.21",
      }),
    );
    const otherBoard = await GET(
      publicRequest("http://localhost/api/requests", {
        ip: "203.0.113.22",
      }),
    );

    expect((await votedBoard.json()).requests[0].viewerHasVoted).toBe(true);
    expect((await otherBoard.json()).requests[0].viewerHasVoted).toBe(false);
  });

  it("rejects cross-origin and invalid public submissions", async () => {
    const crossOrigin = await POST(
      publicRequest("http://localhost/api/requests", {
        method: "POST",
        origin: "https://attacker.example",
        body: {
          title: "A valid-looking request",
          description: "This request should still be rejected by origin.",
          turnstileToken: "test-turnstile-token",
        },
      }),
    );
    const invalid = await POST(
      publicRequest("http://localhost/api/requests", {
        method: "POST",
        body: {
          title: "x",
          description: "short",
          turnstileToken: "test-turnstile-token",
        },
      }),
    );

    expect(crossOrigin.status).toBe(403);
    expect(invalid.status).toBe(400);
  });

  it("throttles repeated submissions and never returns a raw IP", async () => {
    const ip = "203.0.113.44";
    const responses = [];
    for (const title of ["Request alpha", "Request beta", "Request gamma"]) {
      responses.push(await create(title, ip));
    }
    const limited = await create("Request delta", ip);

    expect(responses.every(({ response }) => response.status === 202)).toBe(true);
    expect(limited.response.status).toBe(429);
    expect(JSON.stringify([...responses, limited])).not.toContain(ip);
  });
});
