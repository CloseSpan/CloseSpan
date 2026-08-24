import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDiscordInstallUrl,
  discordOAuthRedirectUri,
  listDiscordGuildChannels,
  registerDiscordCommands,
} from "./discord-api";

const ENV_KEYS = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_BOT_TOKEN",
  "DISCORD_OAUTH_REDIRECT_URI",
  "NEXT_PUBLIC_APP_URL",
  "AUTH_URL",
] as const;
const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function configure() {
  process.env.DISCORD_CLIENT_ID = "123456789";
  process.env.DISCORD_CLIENT_SECRET = "client-secret";
  process.env.DISCORD_BOT_TOKEN = "bot-token";
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

describe("Discord app API", () => {
  it("uses the installation request origin instead of AUTH_URL for OAuth callbacks", () => {
    process.env.AUTH_URL = "https://closespan.com";
    process.env.NEXT_PUBLIC_APP_URL = "https://closespan.com";

    expect(discordOAuthRedirectUri("https://www.closespan.com")).toBe(
      "https://www.closespan.com/api/integrations/discord/callback",
    );
  });

  it("supports an explicit canonical Discord OAuth callback", () => {
    process.env.DISCORD_OAUTH_REDIRECT_URI =
      "https://connect.closespan.com/api/integrations/discord/callback";

    expect(discordOAuthRedirectUri("https://www.closespan.com")).toBe(
      "https://connect.closespan.com/api/integrations/discord/callback",
    );
  });

  it("builds a least-privilege server installation URL", () => {
    configure();
    const url = new URL(
      buildDiscordInstallUrl({
        state: "signed-state",
        redirectUri: "https://closespan.com/api/integrations/discord/callback",
      }),
    );

    expect(url.searchParams.get("scope")).toBe(
      "bot applications.commands identify guilds",
    );
    expect(url.searchParams.get("permissions")).toBe("68608");
    expect(url.searchParams.get("state")).toBe("signed-state");
  });

  it("registers slash and message-context commands", async () => {
    configure();
    const request = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(init?.body?.toString() ?? "[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await registerDiscordCommands("987654321", request as typeof fetch);

    const [url, init] = request.mock.calls[0];
    expect(url).toContain("/applications/123456789/guilds/987654321/commands");
    expect(init?.method).toBe("PUT");
    const commands = JSON.parse(String(init?.body));
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "closespan", type: 1 }),
        expect.objectContaining({ name: "Report to CloseSpan", type: 3 }),
      ]),
    );
  });

  it("only returns Discord text and announcement channels", async () => {
    configure();
    const request = vi.fn(async () =>
      Response.json([
        { id: "3", name: "voice", type: 2, position: 0 },
        { id: "2", name: "announcements", type: 5, position: 2 },
        { id: "1", name: "feedback", type: 0, position: 1 },
      ]),
    );

    await expect(
      listDiscordGuildChannels("987654321", request as typeof fetch),
    ).resolves.toEqual([
      { id: "1", name: "feedback", type: 0, position: 1, parentId: null },
      { id: "2", name: "announcements", type: 5, position: 2, parentId: null },
    ]);
  });
});
