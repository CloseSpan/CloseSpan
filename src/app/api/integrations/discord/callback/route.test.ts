import { beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({ adminRead: vi.fn() }));
const discord = vi.hoisted(() => ({
  exchange: vi.fn(),
  register: vi.fn(),
  redirectUri: vi.fn(),
}));
const repository = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock("@/lib/request-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/request-security")>();
  return { ...actual, authorizeAdminRead: security.adminRead };
});
vi.mock("@/lib/discord-api", () => ({
  exchangeDiscordOAuthCode: discord.exchange,
  registerDiscordCommands: discord.register,
  discordOAuthRedirectUri: discord.redirectUri,
}));
vi.mock("@/lib/discord-app-repository", () => ({
  saveDiscordInstallation: repository.save,
}));

import { NextRequest } from "next/server";
import {
  createDiscordInstallStateToken,
  DISCORD_INSTALL_STATE_COOKIE,
} from "@/lib/discord-app-state";
import { GET } from "./route";

const secret = "discord-callback-test-secret-with-at-least-32-characters";
const context = {
  orgId: "org-1",
  actorId: "admin-1",
  actorName: "Admin",
  role: "Admin",
  traceId: "trace-1",
};
const installation = {
  accessToken: "discord-access-token",
  guildId: "123456789012345678",
  guildName: "CloseSpan Community",
  botUserId: "987654321098765432",
  scopes: ["bot", "applications.commands"],
};

function callbackRequest(input: {
  includeCookie?: boolean;
  cookieToken?: string;
  returnTo?: "/integrations" | "/onboarding";
} = {}) {
  const token = createDiscordInstallStateToken(
    {
      orgId: context.orgId,
      actorId: context.actorId,
      returnTo: input.returnTo ?? "/integrations",
    },
    new Date(),
    secret,
  );
  const url = new URL("https://www.closespan.com/api/integrations/discord/callback");
  url.searchParams.set("code", "temporary-code");
  url.searchParams.set("state", token);
  const cookieToken = input.cookieToken ?? token;
  return new NextRequest(url, {
    headers:
      input.includeCookie === false
        ? {}
        : { cookie: `${DISCORD_INSTALL_STATE_COOKIE}=${cookieToken}` },
  });
}

describe("Discord installation callback", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", secret);
    security.adminRead.mockReset().mockResolvedValue(context);
    discord.redirectUri
      .mockReset()
      .mockReturnValue("https://www.closespan.com/api/integrations/discord/callback");
    discord.exchange.mockReset().mockResolvedValue(installation);
    discord.register.mockReset().mockResolvedValue(undefined);
    repository.save.mockReset().mockResolvedValue({
      ...installation,
      intakeMode: "commands",
      monitoredChannelIds: [],
      state: "Connected",
      installedAt: new Date().toISOString(),
    });
  });

  it("durably saves the Discord server before registering commands", async () => {
    const calls: string[] = [];
    repository.save.mockImplementation(async () => {
      calls.push("save");
      return {};
    });
    discord.register.mockImplementation(async () => {
      calls.push("register");
    });

    const response = await GET(callbackRequest());
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/integrations");
    expect(location.searchParams.get("discord")).toBe("connected");
    expect(location.searchParams.get("focus")).toBe("int_discord");
    expect(calls).toEqual(["save", "register"]);
  });

  it("keeps the connection when command registration needs a retry", async () => {
    discord.register.mockRejectedValue(new Error("Discord command API unavailable"));

    const response = await GET(callbackRequest());
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.searchParams.get("discord")).toBe("connected");
    expect(location.searchParams.get("reason")).toBe("commands_registration_failed");
    expect(repository.save).toHaveBeenCalledWith({
      orgId: context.orgId,
      installation,
      context,
    });
  });

  it("accepts a valid signed query state when the cross-host cookie is unavailable", async () => {
    const response = await GET(callbackRequest({ includeCookie: false }));
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.searchParams.get("discord")).toBe("connected");
    expect(discord.exchange).toHaveBeenCalled();
    expect(repository.save).toHaveBeenCalled();
  });

  it("rejects a callback when a present cookie conflicts with the signed query state", async () => {
    const response = await GET(
      callbackRequest({ cookieToken: "different-signed-state-token" }),
    );
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.searchParams.get("discord")).toBe("error");
    expect(location.searchParams.get("reason")).toBe("400");
    expect(discord.exchange).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
});
