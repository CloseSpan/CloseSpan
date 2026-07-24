import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_TEST_SECRET_KEY,
  turnstileSiteKey,
  verifyTurnstileToken,
} from "./turnstile";
import {
  TURNSTILE_ACTIONS,
  TURNSTILE_TEST_SITE_KEY,
} from "./turnstile-config";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function productionConfiguration() {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "production-secret-key");
  vi.stubEnv("TURNSTILE_EXPECTED_HOSTNAME", "closespan.com");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "production-site-key");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Cloudflare Turnstile verification", () => {
  it("uses Cloudflare's documented test keys only outside production", async () => {
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("TURNSTILE_EXPECTED_HOSTNAME", "");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({
          success: true,
          hostname: "localhost",
          action: "test",
          "error-codes": [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    expect(turnstileSiteKey()).toBe(TURNSTILE_TEST_SITE_KEY);
    await expect(
      verifyTurnstileToken(
        "XXXX.DUMMY.TOKEN.XXXX",
        TURNSTILE_ACTIONS.featureRequestSubmit,
        "127.0.0.1",
      ),
    ).resolves.toBeUndefined();

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = request.body as URLSearchParams;
    expect(body.get("secret")).toBe(TURNSTILE_TEST_SECRET_KEY);
    expect(body.get("remoteip")).toBe("127.0.0.1");
  });

  it("fails closed when production configuration is incomplete", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("TURNSTILE_EXPECTED_HOSTNAME", "closespan.com");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(turnstileSiteKey()).toBe("");
    await expect(
      verifyTurnstileToken(
        "token",
        TURNSTILE_ACTIONS.featureRequestSubmit,
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses Cloudflare test secrets in production", async () => {
    productionConfiguration();
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_TEST_SECRET_KEY);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyTurnstileToken("token", TURNSTILE_ACTIONS.featureRequestVote),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires the exact production action and hostname", async () => {
    productionConfiguration();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          hostname: "closespan.com",
          action: TURNSTILE_ACTIONS.featureRequestVote,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          hostname: "closespan.com",
          action: TURNSTILE_ACTIONS.featureRequestSubmit,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          hostname: "preview.example.com",
          action: TURNSTILE_ACTIONS.featureRequestVote,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyTurnstileToken(
        "valid-token",
        TURNSTILE_ACTIONS.featureRequestVote,
        "203.0.113.8",
      ),
    ).resolves.toBeUndefined();
    await expect(
      verifyTurnstileToken(
        "wrong-action-token",
        TURNSTILE_ACTIONS.featureRequestVote,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      verifyTurnstileToken(
        "wrong-host-token",
        TURNSTILE_ACTIONS.featureRequestVote,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects failed, malformed, and unreachable Siteverify responses", async () => {
    productionConfiguration();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ unexpected: true }))
      .mockRejectedValueOnce(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyTurnstileToken("failed", TURNSTILE_ACTIONS.featureRequestVote),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      verifyTurnstileToken("malformed", TURNSTILE_ACTIONS.featureRequestVote),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      verifyTurnstileToken("offline", TURNSTILE_ACTIONS.featureRequestVote),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("rejects missing and oversized tokens before calling Siteverify", async () => {
    productionConfiguration();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyTurnstileToken(" ", TURNSTILE_ACTIONS.featureRequestSubmit),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      verifyTurnstileToken(
        "x".repeat(2_049),
        TURNSTILE_ACTIONS.featureRequestSubmit,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
