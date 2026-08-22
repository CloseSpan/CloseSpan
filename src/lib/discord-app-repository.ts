import { randomUUID } from "node:crypto";
import { decryptCredential, encryptCredential } from "./credential-crypto";
import { databasePool, transaction } from "./db";
import type { DiscordOAuthInstallation } from "./discord-api";
import { ensureIntegrationCatalog } from "./integration-repository";
import type { RequestContext } from "./request-security";
import { HttpError } from "./request-security";

const DISCORD_CREDENTIAL_PROVIDER = "discord-app-bot";

export type DiscordIntakeMode = "commands" | "channels";

export interface DiscordInstallation {
  guildId: string;
  guildName: string | null;
  botUserId: string;
  scopes: string[];
  intakeMode: DiscordIntakeMode;
  monitoredChannelIds: string[];
  state: "Connected" | "Disconnected" | "Needs reconnect";
  installedAt: string;
}

interface DiscordInstallationRow {
  org_id: string;
  guild_id: string;
  guild_name: string | null;
  bot_user_id: string;
  encrypted_access_token: string;
  token_iv: string;
  token_auth_tag: string;
  scopes: string[];
  intake_mode: DiscordIntakeMode;
  monitored_channel_ids: string[];
  state: DiscordInstallation["state"];
  installed_at: Date;
}

function publicInstallation(row: DiscordInstallationRow): DiscordInstallation {
  return {
    guildId: row.guild_id,
    guildName: row.guild_name,
    botUserId: row.bot_user_id,
    scopes: row.scopes ?? [],
    intakeMode: row.intake_mode,
    monitoredChannelIds: row.monitored_channel_ids ?? [],
    state: row.state,
    installedAt: row.installed_at.toISOString(),
  };
}

async function installationRowByOrg(
  orgId: string,
): Promise<DiscordInstallationRow | null> {
  const result = await databasePool().query<DiscordInstallationRow>(
    `SELECT org_id,guild_id,guild_name,bot_user_id,encrypted_access_token,
            token_iv,token_auth_tag,scopes,intake_mode,monitored_channel_ids,
            state,installed_at
       FROM discord_app_installations WHERE org_id=$1`,
    [orgId],
  );
  return result.rows[0] ?? null;
}

export async function getDiscordInstallation(
  orgId: string,
): Promise<DiscordInstallation | null> {
  const row = await installationRowByOrg(orgId);
  return row ? publicInstallation(row) : null;
}

export async function getDiscordInstallationByGuild(
  guildId: string,
): Promise<{ orgId: string; installation: DiscordInstallation } | null> {
  const result = await databasePool().query<DiscordInstallationRow>(
    `SELECT org_id,guild_id,guild_name,bot_user_id,encrypted_access_token,
            token_iv,token_auth_tag,scopes,intake_mode,monitored_channel_ids,
            state,installed_at
       FROM discord_app_installations
      WHERE guild_id=$1 AND state='Connected'`,
    [guildId],
  );
  const row = result.rows[0];
  return row ? { orgId: row.org_id, installation: publicInstallation(row) } : null;
}

export async function getDiscordOAuthAccessToken(orgId: string): Promise<string | null> {
  const row = await installationRowByOrg(orgId);
  if (!row || row.state !== "Connected") return null;
  return decryptCredential(
    {
      ciphertext: row.encrypted_access_token,
      iv: row.token_iv,
      authTag: row.token_auth_tag,
    },
    orgId,
    DISCORD_CREDENTIAL_PROVIDER,
  );
}

export async function saveDiscordInstallation(input: {
  orgId: string;
  installation: DiscordOAuthInstallation;
  context: Pick<RequestContext, "actorId" | "actorName" | "traceId">;
}): Promise<DiscordInstallation> {
  await ensureIntegrationCatalog(input.orgId);
  const owner = await databasePool().query<{ org_id: string }>(
    "SELECT org_id FROM discord_app_installations WHERE guild_id=$1 AND org_id<>$2",
    [input.installation.guildId, input.orgId],
  );
  if (owner.rowCount) {
    throw new HttpError(
      409,
      "This Discord server is already connected to another CloseSpan workspace.",
    );
  }
  const encrypted = encryptCredential(
    input.installation.accessToken,
    input.orgId,
    DISCORD_CREDENTIAL_PROVIDER,
  );
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO discord_app_installations(
         org_id,guild_id,guild_name,bot_user_id,encrypted_access_token,
         token_iv,token_auth_tag,scopes,state,installed_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'Connected',$9)
       ON CONFLICT(org_id) DO UPDATE SET
         guild_id=excluded.guild_id,guild_name=excluded.guild_name,
         bot_user_id=excluded.bot_user_id,
         encrypted_access_token=excluded.encrypted_access_token,
         token_iv=excluded.token_iv,token_auth_tag=excluded.token_auth_tag,
         scopes=excluded.scopes,state='Connected',installed_by=excluded.installed_by,
         installed_at=now(),updated_at=now()`,
      [
        input.orgId,
        input.installation.guildId,
        input.installation.guildName,
        input.installation.botUserId,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        JSON.stringify(input.installation.scopes),
        input.context.actorId,
      ],
    );
    await client.query(
      `UPDATE integrations
          SET connection_state='Connected',data_scope='Community messages',
              permissions=$2::jsonb,updated_at=now(),error_message=NULL
        WHERE org_id=$1 AND id='int_discord'`,
      [input.orgId, JSON.stringify(input.installation.scopes)],
    );
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,'Installed the CloseSpan Discord bot','DiscordApp',$5,$6)
       ON CONFLICT(org_id,trace_id,action) DO NOTHING`,
      [
        randomUUID(), input.orgId, input.context.actorId, input.context.actorName,
        input.installation.guildId, input.context.traceId,
      ],
    );
  });
  const saved = await getDiscordInstallation(input.orgId);
  if (!saved) throw new Error("Discord installation was not saved.");
  return saved;
}

export async function updateDiscordIntakeSettings(input: {
  orgId: string;
  intakeMode: DiscordIntakeMode;
  monitoredChannelIds: string[];
  context: Pick<RequestContext, "actorId" | "actorName" | "traceId">;
}): Promise<DiscordInstallation> {
  const channelIds = [...new Set(input.monitoredChannelIds)].filter((id) => /^\d{5,24}$/.test(id));
  if (input.intakeMode === "channels" && channelIds.length === 0) {
    throw new HttpError(400, "Select at least one Discord channel to monitor.");
  }
  const result = await databasePool().query(
    `UPDATE discord_app_installations
        SET intake_mode=$2,monitored_channel_ids=$3::jsonb,updated_at=now()
      WHERE org_id=$1 AND state='Connected'`,
    [input.orgId, input.intakeMode, JSON.stringify(channelIds)],
  );
  if (!result.rowCount) throw new HttpError(409, "Connect Discord before changing intake settings.");
  await databasePool().query(
    `INSERT INTO audit_events(
       id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
     ) VALUES($1,$2,$3,$4,$5,'DiscordApp',$2,$6)
     ON CONFLICT(org_id,trace_id,action) DO NOTHING`,
    [
      randomUUID(), input.orgId, input.context.actorId, input.context.actorName,
      input.intakeMode === "channels"
        ? "Enabled selected-channel Discord intake"
        : "Enabled command-only Discord intake",
      input.context.traceId,
    ],
  );
  const saved = await getDiscordInstallation(input.orgId);
  if (!saved) throw new Error("Discord settings could not be loaded.");
  return saved;
}

export async function disconnectDiscordInstallation(input: {
  orgId: string;
  context: Pick<RequestContext, "actorId" | "actorName" | "traceId">;
}): Promise<DiscordInstallation | null> {
  await transaction(async (client) => {
    await client.query(
      `UPDATE discord_app_installations
          SET state='Disconnected',monitored_channel_ids='[]'::jsonb,updated_at=now()
        WHERE org_id=$1`,
      [input.orgId],
    );
    await client.query(
      `UPDATE integrations
          SET connection_state='Not connected',data_scope='None',permissions='[]'::jsonb,
              updated_at=now(),error_message=NULL
        WHERE org_id=$1 AND id='int_discord'`,
      [input.orgId],
    );
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,'Disconnected the CloseSpan Discord bot','DiscordApp',$2,$5)
       ON CONFLICT(org_id,trace_id,action) DO NOTHING`,
      [randomUUID(), input.orgId, input.context.actorId, input.context.actorName, input.context.traceId],
    );
  });
  return getDiscordInstallation(input.orgId);
}
