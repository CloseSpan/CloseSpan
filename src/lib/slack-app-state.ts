import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { HttpError } from "./request-security";

export const SLACK_INSTALL_STATE_COOKIE = "closespan_slack_install";
export const SLACK_INSTALL_STATE_TTL_SECONDS = 10 * 60;

interface SlackInstallStatePayload {
  version: 1;
  nonce: string;
  orgId: string;
  actorId: string;
  expiresAt: string;
}

function stateSecret(explicit?: string): string {
  const secret =
    explicit ?? process.env.SLACK_INSTALL_STATE_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SLACK_INSTALL_STATE_SECRET or AUTH_SECRET with at least 32 characters is required",
    );
  }
  return secret;
}

function signature(payload: string, secret?: string): string {
  return createHmac("sha256", stateSecret(secret))
    .update(payload, "utf8")
    .digest("base64url");
}

export function createSlackInstallStateToken(
  input: { orgId: string; actorId: string },
  now = new Date(),
  secret?: string,
): string {
  const payload: SlackInstallStatePayload = {
    version: 1,
    nonce: randomUUID(),
    orgId: input.orgId,
    actorId: input.actorId,
    expiresAt: new Date(
      now.getTime() + SLACK_INSTALL_STATE_TTL_SECONDS * 1_000,
    ).toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifySlackInstallStateToken(
  token: string,
  now = new Date(),
  secret?: string,
): SlackInstallStatePayload {
  const [encoded, supplied, extra] = token.split(".");
  if (!encoded || !supplied || extra) {
    throw new HttpError(400, "Invalid Slack installation state");
  }
  const expected = signature(encoded, secret);
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  ) {
    throw new HttpError(400, "Invalid Slack installation state");
  }

  let payload: SlackInstallStatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as SlackInstallStatePayload;
  } catch {
    throw new HttpError(400, "Invalid Slack installation state");
  }
  if (
    payload.version !== 1 ||
    !/^[0-9a-f-]{36}$/i.test(payload.nonce) ||
    !payload.orgId ||
    !payload.actorId ||
    !Number.isFinite(Date.parse(payload.expiresAt))
  ) {
    throw new HttpError(400, "Invalid Slack installation state");
  }
  if (Date.parse(payload.expiresAt) <= now.getTime()) {
    throw new HttpError(410, "Slack installation request expired");
  }
  return payload;
}
