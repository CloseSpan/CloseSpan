import { NextRequest } from "next/server";
import type { WorkspaceUser } from "./auth-user";
import { ORG_ID } from "./seed";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export interface RequestContext {
  orgId: string;
  actorId: string;
  actorName: string;
  role: string;
  idempotencyKey: string;
  traceId: string;
}

const rateLimits = new Map<string, { count: number; resetAt: number }>();

function enforceSameOrigin(request: NextRequest, mode: string): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const source = new URL(origin);
  if (source.origin === request.nextUrl.origin) return;
  const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
  // The Codex in-app browser and some local reverse proxies rewrite the
  // destination host while preserving the browser's loopback Origin header.
  // This exception is intentionally demo-only; production still requires an
  // exact origin match before any mutation is authorized.
  const demoLoopbackProxy = mode !== "production" && loopback.has(source.hostname);
  if (!demoLoopbackProxy) throw new HttpError(403, "Cross-origin action rejected");
}

function enforceRateLimit(request: NextRequest, actorId: string): void {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const key = `${forwarded ?? "local"}:${actorId}:${request.nextUrl.pathname}`;
  const current = rateLimits.get(key); const now = Date.now();
  if (!current || current.resetAt <= now) { rateLimits.set(key, { count: 1, resetAt: now + 60_000 }); return; }
  if (current.count >= 30) throw new HttpError(429, "Too many requests");
  current.count += 1;
}

function testUser(request: NextRequest): WorkspaceUser | null | undefined {
  if (process.env.NODE_ENV !== "test") return undefined;
  if (request.headers.get("x-test-auth") === "none") return null;
  return {
    id: request.headers.get("x-test-user-id") ?? "demo_user_avery",
    orgId: ORG_ID,
    name: request.headers.get("x-test-user-name") ?? "Avery Chen",
    email: request.headers.get("x-test-user-email") ?? "avery@example.com",
    role: request.headers.get("x-test-user-role") ?? "Admin",
  };
}

async function authenticatedUser(request: NextRequest): Promise<WorkspaceUser> {
  const testIdentity = testUser(request);
  if (testIdentity !== undefined) {
    if (!testIdentity) throw new HttpError(401, "Authentication required");
    return testIdentity;
  }

  const { resolveWorkspaceAccess } = await import("./auth-user");
  const access = await resolveWorkspaceAccess();
  if (access.status === "unauthenticated")
    throw new HttpError(401, "Authentication required");
  if (access.status === "denied")
    throw new HttpError(403, "Workspace membership is required");
  return access.user;
}

function enforceOrganizationScope(
  request: NextRequest,
  user: WorkspaceUser,
): void {
  const requestedOrgId = request.headers.get("x-org-id");
  if (requestedOrgId && requestedOrgId !== user.orgId)
    throw new HttpError(403, "Organization scope is invalid");
}

export async function authorizeMutation(
  request: NextRequest,
): Promise<RequestContext> {
  const mode = process.env.APP_MODE ?? (process.env.NODE_ENV === "production" ? "production" : "demo");
  enforceSameOrigin(request, mode);
  const user = await authenticatedUser(request);
  enforceOrganizationScope(request, user);
  if (!["Admin", "Contributor"].includes(user.role))
    throw new HttpError(403, "Contributor permission is required");
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) throw new HttpError(400, "A valid idempotency key is required");
  enforceRateLimit(request, user.id);
  return {
    orgId: user.orgId,
    actorId: user.id,
    actorName: user.name,
    role: user.role,
    idempotencyKey,
    traceId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
  };
}

export async function authorizeAdminMutation(
  request: NextRequest,
): Promise<RequestContext> {
  const context = await authorizeMutation(request);
  if (context.role !== "Admin") throw new HttpError(403,"Administrator permission is required");
  return context;
}

export async function authorizeRead(
  request: NextRequest,
): Promise<Pick<RequestContext, "orgId" | "actorId" | "actorName" | "traceId">> {
  const user = await authenticatedUser(request);
  enforceOrganizationScope(request, user);
  return {
    orgId: user.orgId,
    actorId: user.id,
    actorName: user.name,
    traceId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
  };
}

export function errorResponse(error: unknown): Response {
  const known = error instanceof HttpError;
  return Response.json({ error: known ? error.message : "The action could not be completed" }, {
    status: known ? error.status : error instanceof Error && error.message.includes("cannot") ? 409 : 409,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export const noStoreHeaders = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };
