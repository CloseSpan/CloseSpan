import { afterEach, describe, expect, it, vi } from "vitest";
import {
  featureRequestFingerprint,
  featureRequestRateLimitIdentity,
  isFeatureRequestModerator,
  normalizeClientIp,
  publicClientIp,
} from "./feature-request-security";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("feature request client identity", () => {
  it("normalizes IPv4 ports and equivalent IPv6 spellings", () => {
    expect(normalizeClientIp("203.0.113.9:443")).toBe("203.0.113.9");
    expect(normalizeClientIp("[2001:0db8:0:0:0:0:0:1]:443")).toBe(
      "2001:db8::1",
    );
    expect(normalizeClientIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeClientIp("not-an-ip")).toBeNull();
  });

  it("uses the Vercel-controlled client header in Vercel mode", () => {
    vi.stubEnv("VERCEL", "1");
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.12, 10.0.0.1",
      "x-forwarded-for": "198.51.100.4",
      "x-real-ip": "198.51.100.5",
    });

    expect(publicClientIp(headers)).toBe("203.0.113.12");
  });

  it("fails closed on non-Vercel production unless a trusted proxy is explicit", () => {
    vi.stubEnv("APP_MODE", "production");
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.18",
      "x-real-ip": "203.0.113.19",
    });

    expect(publicClientIp(headers)).toBeNull();
    vi.stubEnv("FEATURE_REQUEST_TRUST_PROXY", "1");
    expect(publicClientIp(headers)).toBe("203.0.113.18");
  });

  it("creates stable request-scoped fingerprints without exposing the IP", () => {
    vi.stubEnv(
      "FEATURE_REQUEST_IP_SECRET",
      "test-feature-request-secret-that-is-long-enough",
    );
    const clientIp = "203.0.113.27";
    const first = featureRequestFingerprint(clientIp, "vote:request-a");
    const replay = featureRequestFingerprint(clientIp, "vote:request-a");
    const otherRequest = featureRequestFingerprint(clientIp, "vote:request-b");

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(replay);
    expect(first).not.toBe(otherRequest);
    expect(first).not.toContain(clientIp);
  });

  it("uses short-lived, action-scoped identities for distributed limits", () => {
    vi.stubEnv(
      "FEATURE_REQUEST_IP_SECRET",
      "test-feature-request-secret-that-is-long-enough",
    );
    const headers = new Headers({ "x-test-client-ip": "203.0.113.30" });
    const first = featureRequestRateLimitIdentity(
      headers,
      "submit",
      3600,
      Date.UTC(2026, 6, 22, 10, 15),
    );
    const nextHour = featureRequestRateLimitIdentity(
      headers,
      "submit",
      3600,
      Date.UTC(2026, 6, 22, 11, 15),
    );
    const vote = featureRequestRateLimitIdentity(
      headers,
      "vote",
      3600,
      Date.UTC(2026, 6, 22, 10, 15),
    );

    expect(first.windowStart.toISOString()).toBe("2026-07-22T10:00:00.000Z");
    expect(first.actorHash).not.toBe(nextHour.actorHash);
    expect(first.actorHash).not.toBe(vote.actorHash);
  });

  it("limits production moderation to allowlisted administrators", () => {
    vi.stubEnv("APP_MODE", "production");
    vi.stubEnv(
      "FEATURE_REQUEST_MODERATOR_EMAILS",
      "owner@example.com, roadmap@example.com",
    );

    expect(isFeatureRequestModerator("OWNER@example.com", "Admin")).toBe(true);
    expect(isFeatureRequestModerator("owner@example.com", "Contributor")).toBe(
      false,
    );
    expect(isFeatureRequestModerator("customer@example.com", "Admin")).toBe(
      false,
    );
  });
});
