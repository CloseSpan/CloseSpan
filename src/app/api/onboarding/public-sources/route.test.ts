import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetPublicDiscoveryCostGuardForTests } from "@/lib/public-discovery-cost-guard";
import { POST } from "./route";

function request(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/onboarding/public-sources", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      "Idempotency-Key": "public-source-test",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  resetPublicDiscoveryCostGuardForTests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/onboarding/public-sources", () => {
  it("returns a non-blocking disabled state when public discovery is off", async () => {
    vi.stubEnv("YOU_PUBLIC_DISCOVERY_ENABLED", "false");
    vi.stubEnv("BRIGHT_DATA_PUBLIC_DISCOVERY_ENABLED", "false");

    const firstResponse = await POST(
      request({ productName: "Acme", productUrl: "https://acme.example" }),
    );
    const replayResponse = await POST(
      request({ productName: "Acme", productUrl: "https://acme.example" }),
    );

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(200);
    expect(await firstResponse.json()).toEqual({
      status: "disabled",
      provider: null,
      sources: [],
    });
    expect(firstResponse.headers.get("Cache-Control")).toContain("no-store");
  });

  it("rejects invalid product input without returning validation internals", async () => {
    const response = await POST(
      request({ productName: "Acme", productUrl: "file:///etc/passwd" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Valid product details are required",
    });
  });

  it("requires mutation protections before invoking a paid provider", async () => {
    const response = await POST(
      request(
        { productName: "Acme", productUrl: "https://acme.example" },
        { "Idempotency-Key": "bad" },
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A valid idempotency key is required",
    });
  });

  it("hides upstream provider errors behind an unavailable state", async () => {
    vi.stubEnv("YOU_PUBLIC_DISCOVERY_ENABLED", "true");
    vi.stubEnv("YOU_API_KEY", "you-secret-key");
    vi.stubEnv("BRIGHT_DATA_PUBLIC_DISCOVERY_ENABLED", "false");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("raw upstream credential error", { status: 401 }),
      ),
    );
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const response = await POST(
      request({ productName: "Acme", productUrl: "https://acme.example" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "unavailable",
      provider: null,
      sources: [],
    });
    expect(JSON.stringify(body)).not.toContain("raw upstream");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("raw upstream");
  });

  it("deduplicates paid discovery before making another provider request", async () => {
    vi.stubEnv("YOU_PUBLIC_DISCOVERY_ENABLED", "true");
    vi.stubEnv("YOU_API_KEY", "you-secret-key");
    const fetchImpl = vi.fn(async () =>
      Response.json({ results: { web: [] } }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const input = { productName: "Acme", productUrl: "https://acme.example" };

    expect((await POST(request(input))).status).toBe(200);
    const duplicate = await POST(request(input));

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({
      error: "This discovery request was already submitted",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns a safe 429 after five paid discovery claims in a minute", async () => {
    vi.stubEnv("YOU_PUBLIC_DISCOVERY_ENABLED", "true");
    vi.stubEnv("YOU_API_KEY", "you-secret-key");
    const fetchImpl = vi.fn(async () =>
      Response.json({ results: { web: [] } }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const input = { productName: "Acme", productUrl: "https://acme.example" };

    for (let index = 0; index < 5; index += 1) {
      const response = await POST(
        request(input, { "Idempotency-Key": `public-paid-${index}` }),
      );
      expect(response.status).toBe(200);
    }
    const limited = await POST(
      request(input, { "Idempotency-Key": "public-paid-six" }),
    );

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error:
        "Public feedback discovery is busy. Please try again in a minute.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});
