import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSlackInstallUrl,
  exchangeSlackOAuthCode,
  slackAppConfigured,
} from "./slack-app-repository";

describe("CloseSpan Slack app OAuth", () => {
  beforeEach(() => {
    vi.stubEnv("SLACK_CLIENT_ID", "123456.7890");
    vi.stubEnv("SLACK_CLIENT_SECRET", "slack-client-secret");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("requests only the bot scopes used by CloseSpan", () => {
    expect(slackAppConfigured()).toBe(true);
    const url = new URL(
      buildSlackInstallUrl({
        state: "signed-state",
        redirectUri: "https://www.closespan.com/api/integrations/slack/callback",
      }),
    );

    expect(url.origin).toBe("https://slack.com");
    expect(url.searchParams.get("scope")?.split(",")).toEqual([
      "app_mentions:read",
      "channels:join",
      "chat:write",
    ]);
    expect(url.searchParams.get("state")).toBe("signed-state");
  });

  it("normalizes Slack's bot installation response", async () => {
    const request = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          access_token: "xoxb-secret",
          bot_user_id: "UCLOSESPAN",
          scope: "chat:write,app_mentions:read,channels:join",
          team: { id: "T123", name: "Acme" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      exchangeSlackOAuthCode(
        {
          code: "temporary-code",
          redirectUri:
            "https://www.closespan.com/api/integrations/slack/callback",
        },
        request,
      ),
    ).resolves.toEqual({
      accessToken: "xoxb-secret",
      botUserId: "UCLOSESPAN",
      teamId: "T123",
      teamName: "Acme",
      scopes: ["chat:write", "app_mentions:read", "channels:join"],
    });
  });
});
