import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "./request-security";

export const GITHUB_INSTALL_STATE_COOKIE = "closespan_github_install";
export const GITHUB_INSTALL_STATE_TTL_SECONDS = 10 * 60;

interface GithubInstallStatePayload {
  version: 1;
  attemptId: string;
  expiresAt: string;
}

function stateSecret(explicit?: string): string {
  const secret = explicit ?? process.env.GITHUB_INSTALL_STATE_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "GITHUB_INSTALL_STATE_SECRET or AUTH_SECRET with at least 32 characters is required",
    );
  }
  return secret;
}

function signature(payload: string, secret?: string): string {
  return createHmac("sha256", stateSecret(secret))
    .update(payload, "utf8")
    .digest("base64url");
}

export function createGithubInstallStateToken(
  attemptId: string,
  expiresAt: Date,
  secret?: string,
): string {
  const payload: GithubInstallStatePayload = {
    version: 1,
    attemptId,
    expiresAt: expiresAt.toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyGithubInstallStateToken(
  token: string,
  now = new Date(),
  secret?: string,
): GithubInstallStatePayload {
  const [encoded, supplied, extra] = token.split(".");
  if (!encoded || !supplied || extra) throw new HttpError(400, "Invalid GitHub installation state");
  const expected = signature(encoded, secret);
  if (expected.length !== supplied.length) throw new HttpError(400, "Invalid GitHub installation state");
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)))
    throw new HttpError(400, "Invalid GitHub installation state");

  let payload: GithubInstallStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GithubInstallStatePayload;
  } catch {
    throw new HttpError(400, "Invalid GitHub installation state");
  }
  if (
    payload.version !== 1 ||
    !/^[0-9a-f-]{36}$/i.test(payload.attemptId) ||
    !Number.isFinite(Date.parse(payload.expiresAt))
  ) {
    throw new HttpError(400, "Invalid GitHub installation state");
  }
  if (Date.parse(payload.expiresAt) <= now.getTime())
    throw new HttpError(410, "GitHub installation request expired");
  return payload;
}
