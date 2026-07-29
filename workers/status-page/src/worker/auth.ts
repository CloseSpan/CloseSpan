import { createRemoteJWKSet, jwtVerify } from "jose";
import { RequestError } from "./http";

function normalizeTeamDomain(value: string): string {
  return value.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export async function authenticateAdmin(request: Request, env: Env): Promise<string> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw new RequestError(401, "Cloudflare Access authentication is required.");

  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  if (!teamDomain || !env.CF_ACCESS_AUD) throw new RequestError(503, "Administrative access is not configured.");
  const issuer = `https://${teamDomain}`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  let email: string | undefined;
  try {
    const result = await jwtVerify(token, jwks, {
      audience: env.CF_ACCESS_AUD,
      issuer,
    });
    email = typeof result.payload.email === "string" ? result.payload.email.trim().toLowerCase() : undefined;
  } catch (error) {
    console.error(JSON.stringify({ event: "access_jwt_rejected", error: error instanceof Error ? error.name : "unknown" }));
    throw new RequestError(401, "Cloudflare Access authentication is invalid.");
  }

  const allowed = env.STATUS_ADMIN_EMAILS.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!email || !allowed.includes(email)) throw new RequestError(403, "This account cannot manage CloseSpan status.");
  return email;
}

export function requireMutationOrigin(request: Request, env: Env): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("origin");
  if (origin !== env.STATUS_PUBLIC_ORIGIN) throw new RequestError(403, "Request origin is not allowed.");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new RequestError(415, "Administrative requests must use JSON.");
}
