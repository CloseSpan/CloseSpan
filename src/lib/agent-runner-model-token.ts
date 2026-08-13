import { createHash, randomUUID } from "node:crypto";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";

const ISSUER = "closespan";
const AUDIENCE = "closespan-runner-model";
const MAX_TOKEN_LIFETIME_SECONDS = 70 * 60;
const OPAQUE_TOKEN_PREFIX = "csrt_";

export interface AgentRunnerModelClaims extends JWTPayload {
  sub: string;
  orgId: string;
  repository: string;
  promptHash: string;
  executionProfileHash: string;
  provider: "openai";
  model: string;
}

function signingKey(): Uint8Array {
  const secret = process.env.AGENT_EXECUTOR_SHARED_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "AGENT_EXECUTOR_SHARED_SECRET must be configured before issuing runner model tokens",
    );
  }
  return createHash("sha256")
    .update("closespan:runner-model-token:v1\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

export async function issueAgentRunnerModelToken(input: {
  runId: string;
  orgId: string;
  repository: string;
  promptHash: string;
  executionProfileHash: string;
  provider: "openai";
  model: string;
}): Promise<{ token: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1_000);
  const expiration = now + MAX_TOKEN_LIFETIME_SECONDS;
  const signedToken = await new SignJWT({
    orgId: input.orgId,
    repository: input.repository,
    promptHash: input.promptHash,
    executionProfileHash: input.executionProfileHash,
    provider: input.provider,
    model: input.model,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(input.runId)
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setNotBefore(now - 5)
    .setExpirationTime(expiration)
    .sign(signingKey());
  const token = `${OPAQUE_TOKEN_PREFIX}${Buffer.from(signedToken, "utf8").toString("base64url")}`;
  return { token, expiresAt: new Date(expiration * 1_000).toISOString() };
}

export async function verifyAgentRunnerModelToken(
  token: string,
): Promise<AgentRunnerModelClaims> {
  const signedToken = token.startsWith(OPAQUE_TOKEN_PREFIX)
    ? Buffer.from(token.slice(OPAQUE_TOKEN_PREFIX.length), "base64url").toString("utf8")
    : token;
  const verified = await jwtVerify(signedToken, signingKey(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["HS256"],
  });
  const claims = verified.payload;
  if (
    typeof claims.sub !== "string"
    || typeof claims.orgId !== "string"
    || typeof claims.repository !== "string"
    || typeof claims.promptHash !== "string"
    || typeof claims.executionProfileHash !== "string"
    || claims.provider !== "openai"
    || typeof claims.model !== "string"
  ) {
    throw new Error("Runner model token is missing its approval-bound claims");
  }
  return claims as AgentRunnerModelClaims;
}
