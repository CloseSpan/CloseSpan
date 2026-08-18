import { randomUUID } from "node:crypto";
import type { RequestContext } from "./request-security";
import { HttpError } from "./request-security";
import { decryptCredential, encryptCredential } from "./credential-crypto";
import { databasePool, transaction } from "./db";
import type { SlackBotContext } from "./slack-api";

const SLACK_BOT_CREDENTIAL_PROVIDER = "slack-app-bot";

export interface SlackAppInstallation {
  teamId: string;
  teamName: string | null;
  botUserId: string;
  scopes: string[];
  state: "Connected" | "Disconnected" | "Needs reconnect";
  installedAt: string;
}

interface SlackAppInstallationRow {
  team_id: string;
  team_name: string | null;
  bot_user_id: string;
  encrypted_access_token: string;
  token_iv: string;
  token_auth_tag: string;
  scopes: string[];
  state: SlackAppInstallation["state"];
  installed_at: Date;
}

export interface SlackOAuthInstallation {
  accessToken: string;
  teamId: string;
  teamName: string | null;
  botUserId: string;
  scopes: string[];
}

export function slackAppConfigured(): boolean {
  return Boolean(
    process.env.SLACK_CLIENT_ID?.trim() &&
      process.env.SLACK_CLIENT_SECRET?.trim(),
  );
}

export function slackAppConfiguration(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new HttpError(
      503,
      "The CloseSpan Slack app is not configured in this environment.",
    );
  }
  return { clientId, clientSecret };
}

export function buildSlackInstallUrl(input: {
  state: string;
  redirectUri: string;
}): string {
  const { clientId } = slackAppConfiguration();
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set(
    "scope",
    ["app_mentions:read", "channels:join", "chat:write"].join(","),
  );
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export async function exchangeSlackOAuthCode(
  input: { code: string; redirectUri: string },
  request: typeof fetch = fetch,
): Promise<SlackOAuthInstallation> {
  const { clientId, clientSecret } = slackAppConfiguration();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  const response = await request("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    access_token?: string;
    scope?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
  } | null;
  if (!response.ok || payload?.ok !== true) {
    throw new HttpError(
      409,
      `Slack could not install CloseSpan (${payload?.error || "oauth_failed"}).`,
    );
  }
  if (
    !payload.access_token ||
    !payload.bot_user_id ||
    !payload.team?.id
  ) {
    throw new HttpError(409, "Slack returned an incomplete bot installation.");
  }
  return {
    accessToken: payload.access_token,
    botUserId: payload.bot_user_id,
    teamId: payload.team.id,
    teamName: payload.team.name?.trim() || null,
    scopes: (payload.scope ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  };
}

function publicInstallation(
  row: SlackAppInstallationRow,
): SlackAppInstallation {
  return {
    teamId: row.team_id,
    teamName: row.team_name,
    botUserId: row.bot_user_id,
    scopes: row.scopes ?? [],
    state: row.state,
    installedAt: row.installed_at.toISOString(),
  };
}

async function installationRow(
  orgId: string,
): Promise<SlackAppInstallationRow | null> {
  const result = await databasePool().query<SlackAppInstallationRow>(
    `SELECT team_id,team_name,bot_user_id,encrypted_access_token,
            token_iv,token_auth_tag,scopes,state,installed_at
       FROM slack_app_installations WHERE org_id=$1`,
    [orgId],
  );
  return result.rows[0] ?? null;
}

export async function getSlackAppInstallation(
  orgId: string,
): Promise<SlackAppInstallation | null> {
  const row = await installationRow(orgId);
  return row ? publicInstallation(row) : null;
}

export async function getSlackBotContext(input: {
  orgId: string;
}): Promise<{
  context: SlackBotContext;
  installation: SlackAppInstallation;
} | null> {
  const row = await installationRow(input.orgId);
  if (!row || row.state !== "Connected") return null;
  const accessToken = decryptCredential(
    {
      ciphertext: row.encrypted_access_token,
      iv: row.token_iv,
      authTag: row.token_auth_tag,
    },
    input.orgId,
    SLACK_BOT_CREDENTIAL_PROVIDER,
  );
  return {
    context: { orgId: input.orgId, accessToken },
    installation: publicInstallation(row),
  };
}

export async function saveSlackAppInstallation(input: {
  orgId: string;
  installation: SlackOAuthInstallation;
  context: Pick<
    RequestContext,
    "actorId" | "actorName" | "traceId"
  >;
}): Promise<SlackAppInstallation> {
  const encrypted = encryptCredential(
    input.installation.accessToken,
    input.orgId,
    SLACK_BOT_CREDENTIAL_PROVIDER,
  );
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO slack_app_installations(
         org_id,team_id,team_name,bot_user_id,encrypted_access_token,
         token_iv,token_auth_tag,scopes,state,installed_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'Connected',$9)
       ON CONFLICT(org_id) DO UPDATE SET
         team_id=excluded.team_id,team_name=excluded.team_name,
         bot_user_id=excluded.bot_user_id,
         encrypted_access_token=excluded.encrypted_access_token,
         token_iv=excluded.token_iv,token_auth_tag=excluded.token_auth_tag,
         scopes=excluded.scopes,state='Connected',installed_by=excluded.installed_by,
         installed_at=now(),updated_at=now()`,
      [
        input.orgId,
        input.installation.teamId,
        input.installation.teamName,
        input.installation.botUserId,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        JSON.stringify(input.installation.scopes),
        input.context.actorId,
      ],
    );
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,$5,'SlackApp',$6,$7)
       ON CONFLICT(org_id,trace_id,action) DO NOTHING`,
      [
        randomUUID(),
        input.orgId,
        input.context.actorId,
        input.context.actorName,
        "Installed the CloseSpan Slack bot",
        input.installation.teamId,
        input.context.traceId,
      ],
    );
  });
  const saved = await getSlackAppInstallation(input.orgId);
  if (!saved) throw new Error("Slack bot installation was not saved");
  return saved;
}
