import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { ORG_ID } from "./seed";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export interface RequestContext {
  orgId: string;
  actorId: string;
  actorName: string;
  idempotencyKey: string;
  traceId: string;
}

const rateLimits = new Map<string, { count: number; resetAt: number }>();

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function enforceSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) throw new HttpError(403, "Cross-origin action rejected");
}

function enforceRateLimit(request: NextRequest, actorId: string): void {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const key = `${forwarded ?? "local"}:${actorId}:${request.nextUrl.pathname}`;
  const current = rateLimits.get(key); const now = Date.now();
  if (!current || current.resetAt <= now) { rateLimits.set(key, { count: 1, resetAt: now + 60_000 }); return; }
  if (current.count >= 30) throw new HttpError(429, "Too many requests");
  current.count += 1;
}

export function authorizeMutation(request: NextRequest): RequestContext {
  enforceSameOrigin(request);
  const mode = process.env.APP_MODE ?? (process.env.NODE_ENV === "production" ? "production" : "demo");
  let orgId = request.headers.get("x-org-id") ?? "";
  let actorId = "demo_user_avery";
  let actorName = "Avery Chen";

  if (mode === "production") {
    const expected = process.env.TRUSTED_PROXY_SECRET;
    if (process.env.AUTH_TRUSTED_PROXY !== "true" || !expected) throw new HttpError(503, "Production authentication is not configured");
    const provided = request.headers.get("x-feedbackflow-proxy-secret") ?? "";
    if (!safeEqual(provided, expected)) throw new HttpError(401, "Authentication required");
    orgId = request.headers.get("x-organization-id") ?? "";
    actorId = request.headers.get("x-user-id") ?? "";
    actorName = request.headers.get("x-user-name") ?? "Authenticated user";
    if (!actorId) throw new HttpError(401, "Authenticated user context is required");
  }

  if (orgId !== ORG_ID) throw new HttpError(403, "Organization scope is required");
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) throw new HttpError(400, "A valid idempotency key is required");
  enforceRateLimit(request, actorId);
  return { orgId, actorId, actorName, idempotencyKey, traceId: request.headers.get("x-request-id") ?? crypto.randomUUID() };
}

export function authorizeRead(request: NextRequest): Pick<RequestContext, "orgId" | "actorId" | "actorName" | "traceId"> {
  const synthetic = new Headers(request.headers);
  synthetic.set("idempotency-key", "read_request");
  return authorizeMutation(new NextRequest(request.url, { method: "POST", headers: synthetic }));
}

export function errorResponse(error: unknown): Response {
  const known = error instanceof HttpError;
  return Response.json({ error: known ? error.message : "The action could not be completed" }, {
    status: known ? error.status : error instanceof Error && error.message.includes("cannot") ? 409 : 409,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export const noStoreHeaders = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };
