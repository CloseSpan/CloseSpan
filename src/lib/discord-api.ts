import { HttpError } from "./request-security";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_CALLBACK_PATH = "/api/integrations/discord/callback";

export interface DiscordGuildChannel {
  id: string;
  name: string;
  type: number;
  position: number;
  parentId: string | null;
}

export interface DiscordOAuthInstallation {
  accessToken: string;
  guildId: string;
  guildName: string | null;
  botUserId: string;
  scopes: string[];
}

export function discordAppConfigured(): boolean {
  return Boolean(
    process.env.DISCORD_CLIENT_ID?.trim() &&
      process.env.DISCORD_CLIENT_SECRET?.trim() &&
      process.env.DISCORD_BOT_TOKEN?.trim(),
  );
}

export function discordInteractionsConfigured(): boolean {
  return discordAppConfigured() && Boolean(process.env.DISCORD_PUBLIC_KEY?.trim());
}

export function discordOAuthRedirectUri(requestOrigin: string): string {
  const explicit = process.env.DISCORD_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return new URL(explicit).toString();

  // Authentication and public application URLs can use a different canonical
  // hostname from the page that initiated this installation. Keep the OAuth
  // round trip on the initiating origin so the signed state cookie survives.
  const base = requestOrigin.replace(/\/$/, "");
  return new URL(DISCORD_CALLBACK_PATH, base).toString();
}

function discordConfiguration(): {
  clientId: string;
  clientSecret: string;
  botToken: string;
} {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!clientId || !clientSecret || !botToken) {
    throw new HttpError(
      503,
      "The CloseSpan Discord app is not configured in this environment.",
    );
  }
  return { clientId, clientSecret, botToken };
}

export function buildDiscordInstallUrl(input: {
  state: string;
  redirectUri: string;
}): string {
  const { clientId } = discordConfiguration();
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "bot applications.commands identify guilds");
  url.searchParams.set("permissions", "68608");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

async function discordRequest<T>(
  path: string,
  init: RequestInit = {},
  request: typeof fetch = fetch,
): Promise<T> {
  const { botToken } = discordConfiguration();
  const response = await request(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bot ${botToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { message?: string; code?: number })
    | null;
  if (!response.ok) {
    throw new HttpError(
      response.status === 401 || response.status === 403 ? 409 : response.status,
      `Discord request failed (${payload?.message || `HTTP ${response.status}`}).`,
    );
  }
  return payload as T;
}

export async function exchangeDiscordOAuthCode(
  input: { code: string; redirectUri: string },
  request: typeof fetch = fetch,
): Promise<DiscordOAuthInstallation> {
  const { clientId, clientSecret } = discordConfiguration();
  const response = await request(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    scope?: string;
    guild?: { id?: string; name?: string };
    error_description?: string;
  } | null;
  if (!response.ok || !payload?.access_token || !payload.guild?.id) {
    throw new HttpError(
      409,
      `Discord could not install CloseSpan (${payload?.error_description || "incomplete_oauth_response"}).`,
    );
  }
  const bot = await discordRequest<{ id: string }>("/users/@me", {}, request);
  return {
    accessToken: payload.access_token,
    guildId: payload.guild.id,
    guildName: payload.guild.name?.trim() || null,
    botUserId: bot.id,
    scopes: (payload.scope ?? "")
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean),
  };
}

export async function registerDiscordCommands(
  guildId: string,
  request: typeof fetch = fetch,
): Promise<void> {
  const { clientId } = discordConfiguration();
  await discordRequest(
    `/applications/${clientId}/guilds/${guildId}/commands`,
    {
      method: "PUT",
      body: JSON.stringify([
        {
          name: "closespan",
          description: "Report product feedback to CloseSpan",
          type: 1,
          options: [
            {
              name: "report",
              description: "Submit an issue or feature for confirmation",
              type: 1,
              options: [
                {
                  name: "feedback",
                  description: "The issue, request, or customer feedback",
                  type: 3,
                  required: true,
                  max_length: 4000,
                },
              ],
            },
          ],
        },
        { name: "Report to CloseSpan", type: 3 },
      ]),
    },
    request,
  );
}

export async function listDiscordGuildChannels(
  guildId: string,
  request: typeof fetch = fetch,
): Promise<DiscordGuildChannel[]> {
  const channels = await discordRequest<
    Array<{ id: string; name: string; type: number; position?: number; parent_id?: string | null }>
  >(`/guilds/${guildId}/channels`, {}, request);
  return channels
    .filter((channel) => channel.type === 0 || channel.type === 5)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      position: channel.position ?? 0,
      parentId: channel.parent_id ?? null,
    }))
    .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
}

export async function postDiscordMessage(
  channelId: string,
  body: Record<string, unknown>,
  request: typeof fetch = fetch,
): Promise<void> {
  await discordRequest(
    `/channels/${channelId}/messages`,
    { method: "POST", body: JSON.stringify(body) },
    request,
  );
}

export async function leaveDiscordGuild(
  guildId: string,
  request: typeof fetch = fetch,
): Promise<void> {
  await discordRequest(`/users/@me/guilds/${guildId}`, { method: "DELETE" }, request);
}
