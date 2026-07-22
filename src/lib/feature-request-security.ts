import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { ipAddress } from "@vercel/functions";
import { NextRequest } from "next/server";
import { HttpError } from "./request-security";

const LOCAL_CLIENT_IP = "127.0.0.1";
const MAX_PUBLIC_BODY_BYTES = 12_000;

function isProductionMode(): boolean {
  const mode =
    process.env.APP_MODE ??
    (process.env.NODE_ENV === "production" ? "production" : "demo");
  return mode === "production";
}

export function normalizeClientIp(value: string | null | undefined): string | null {
  if (!value) return null;
  let candidate = value.trim().replace(/^"|"$/g, "");
  const bracketed = candidate.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketed?.[1]) candidate = bracketed[1];
  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPort?.[1]) candidate = ipv4WithPort[1];
  const version = isIP(candidate);
  if (version === 4) return candidate;
  if (version !== 6) return null;
  try {
    return new URL(`http://[${candidate}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

function firstForwardedAddress(value: string | null): string | null {
  return normalizeClientIp(value?.split(",")[0]);
}

export function publicClientIp(headers: Headers): string | null {
  if (process.env.NODE_ENV === "test") {
    const testAddress = normalizeClientIp(headers.get("x-test-client-ip"));
    if (testAddress) return testAddress;
  }

  const standardHeaders = new Headers(headers);
  if (process.env.VERCEL === "1") {
    return (
      firstForwardedAddress(headers.get("x-vercel-forwarded-for")) ??
      normalizeClientIp(ipAddress(standardHeaders))
    );
  }

  if (!isProductionMode()) {
    return (
      normalizeClientIp(ipAddress(standardHeaders)) ??
      firstForwardedAddress(headers.get("x-forwarded-for")) ??
      LOCAL_CLIENT_IP
    );
  }

  // Outside Vercel, forwarded headers are trustworthy only when the app is
  // explicitly deployed behind a controlled reverse proxy.
  if (process.env.FEATURE_REQUEST_TRUST_PROXY !== "1") return null;
  return (
    firstForwardedAddress(headers.get("x-forwarded-for")) ??
    normalizeClientIp(ipAddress(standardHeaders))
  );
}

function fingerprintSecret(): string | null {
  const configured = process.env.FEATURE_REQUEST_IP_SECRET ?? "";
  if (configured.length >= 32) return configured;
  if (isProductionMode()) return null;
  return "closespan-local-feature-request-secret-v1";
}

export function featureRequestFingerprint(
  clientIp: string,
  namespace: string,
): string {
  const secret = fingerprintSecret();
  if (!secret)
    throw new HttpError(503, "Feature request voting is temporarily unavailable");
  return createHmac("sha256", secret)
    .update(`closespan:feature-requests:v1\0${namespace}\0${clientIp}`)
    .digest("hex");
}

function requirePublicClientIp(headers: Headers): string {
  const clientIp = publicClientIp(headers);
  if (!clientIp)
    throw new HttpError(503, "Feature request voting is temporarily unavailable");
  return clientIp;
}

export function featureRequestVoteHash(
  headers: Headers,
  requestId: string,
): string {
  return featureRequestFingerprint(
    requirePublicClientIp(headers),
    `vote:${requestId}`,
  );
}

export interface FeatureRequestRateLimitIdentity {
  actorHash: string;
  windowStart: Date;
}

export function featureRequestRateLimitIdentity(
  headers: Headers,
  action: "submit" | "vote",
  windowSeconds: number,
  now = Date.now(),
): FeatureRequestRateLimitIdentity {
  const windowMilliseconds = windowSeconds * 1000;
  const windowStartMs = Math.floor(now / windowMilliseconds) * windowMilliseconds;
  const windowStart = new Date(windowStartMs);
  return {
    actorHash: featureRequestFingerprint(
      requirePublicClientIp(headers),
      `rate:${action}:${windowStart.toISOString()}`,
    ),
    windowStart,
  };
}

export function featureRequestViewerHasher(
  headers: Headers,
): ((requestId: string) => string) | undefined {
  const clientIp = publicClientIp(headers);
  const secret = fingerprintSecret();
  if (!clientIp || !secret) return undefined;
  return (requestId: string) =>
    createHmac("sha256", secret)
      .update(
        `closespan:feature-requests:v1\0vote:${requestId}\0${clientIp}`,
      )
      .digest("hex");
}

export function isFeatureRequestModerator(
  email: string,
  role: string,
): boolean {
  if (role !== "Admin") return false;
  const configured = [
    process.env.FEATURE_REQUEST_MODERATOR_EMAILS,
    process.env.PRODUCTION_OWNER_EMAIL,
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length === 0) return !isProductionMode();
  return configured.includes(email.trim().toLowerCase());
}

export function assertFeatureRequestModerator(
  email: string,
  role: string,
): void {
  if (!isFeatureRequestModerator(email, role))
    throw new HttpError(403, "Feature request moderator access is required");
}

export function assertPublicJsonMutation(request: NextRequest): void {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json"))
    throw new HttpError(415, "JSON is required");

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_PUBLIC_BODY_BYTES)
    throw new HttpError(413, "Request content is too large");

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site")
    throw new HttpError(403, "Cross-origin action rejected");

  const origin = request.headers.get("origin");
  if (!origin) {
    if (isProductionMode())
      throw new HttpError(403, "A same-origin request is required");
    return;
  }
  let source: URL;
  try {
    source = new URL(origin);
  } catch {
    throw new HttpError(403, "Cross-origin action rejected");
  }
  if (source.origin === request.nextUrl.origin) return;

  const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!isProductionMode() && loopback.has(source.hostname)) return;
  throw new HttpError(403, "Cross-origin action rejected");
}

export async function readPublicJson(
  request: NextRequest,
): Promise<unknown> {
  assertPublicJsonMutation(request);
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_PUBLIC_BODY_BYTES)
    throw new HttpError(413, "Request content is too large");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HttpError(400, "Valid JSON is required");
  }
}
