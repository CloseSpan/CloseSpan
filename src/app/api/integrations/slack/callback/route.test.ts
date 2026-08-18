import { beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({ adminRead: vi.fn() }));
const state = vi.hoisted(() => ({ verify: vi.fn() }));
const slackApp = vi.hoisted(() => ({ exchange: vi.fn(), save: vi.fn() }));
const intake = vi.hoisted(() => ({ status: vi.fn(), setMode: vi.fn() }));
const slack = vi.hoisted(() => ({ join: vi.fn(), post: vi.fn() }));

vi.mock("@/lib/request-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/request-security")>();
  return { ...actual, authorizeAdminRead: security.adminRead };
});
vi.mock("@/lib/slack-app-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/slack-app-state")>();
  return { ...actual, verifySlackInstallStateToken: state.verify };
});
vi.mock("@/lib/slack-app-repository", () => ({
  exchangeSlackOAuthCode: slackApp.exchange,
  saveSlackAppInstallation: slackApp.save,
}));
vi.mock("@/lib/slack-intake", () => ({
  getSlackIntakeStatus: intake.status,
  setSlackIntakeMode: intake.setMode,
}));
vi.mock("@/lib/slack-api", () => ({
  joinSlackChannel: slack.join,
  postSlackMessage: slack.post,
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const context = {
  orgId: "org_test",
  actorId: "admin_test",
  actorName: "Admin Test",
  role: "Admin",
  traceId: "trace_test",
};
const installation = {
  accessToken: "xoxb-closespan",
  teamId: "T123",
  teamName: "Acme",
  botUserId: "UCLOSESPAN",
  scopes: ["app_mentions:read", "channels:join", "chat:write"],
};

function request() {
  return new NextRequest(
    "https://www.closespan.com/api/integrations/slack/callback?code=temporary&state=signed",
    { headers: { cookie: "closespan_slack_install=signed" } },
  );
}

describe("CloseSpan Slack app callback", () => {
  beforeEach(() => {
    security.adminRead.mockReset().mockResolvedValue(context);
    state.verify.mockReset().mockReturnValue({
      orgId: "org_test",
      actorId: "admin_test",
    });
    slackApp.exchange.mockReset().mockResolvedValue(installation);
    slackApp.save.mockReset().mockResolvedValue(installation);
    intake.status.mockReset().mockResolvedValue({
      state: "Connected",
      teamId: "T123",
      channelId: "C123",
    });
    intake.setMode.mockReset().mockResolvedValue({ intakeMode: "mentions" });
    slack.join.mockReset().mockResolvedValue(undefined);
    slack.post.mockReset().mockResolvedValue({ ts: "100.1" });
  });

  it("joins the feedback channel, saves the bot, and enables mention-only intake", async () => {
    const response = await GET(request());

    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get(
      "slackBot",
    )).toBe("connected");
    expect(slack.join).toHaveBeenCalledWith(
      { orgId: "org_test", accessToken: "xoxb-closespan" },
      "C123",
    );
    expect(slackApp.save).toHaveBeenCalledWith({
      orgId: "org_test",
      installation,
      context,
    });
    expect(intake.setMode).toHaveBeenCalledWith({
      orgId: "org_test",
      mode: "mentions",
      actor: context,
    });
    expect(slack.post).toHaveBeenCalledWith(
      { orgId: "org_test", accessToken: "xoxb-closespan" },
      expect.objectContaining({
        text: expect.stringContaining("<@UCLOSESPAN>"),
      }),
    );
  });

  it("rejects a callback whose state does not match the install cookie", async () => {
    const response = await GET(
      new NextRequest(
        "https://www.closespan.com/api/integrations/slack/callback?code=temporary&state=other",
        { headers: { cookie: "closespan_slack_install=signed" } },
      ),
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("slackBot")).toBe("error");
    expect(location.searchParams.get("reason")).toBe("invalid_callback");
    expect(slackApp.exchange).not.toHaveBeenCalled();
  });

  it("rejects a bot installed in a different Slack workspace", async () => {
    slackApp.exchange.mockResolvedValue({ ...installation, teamId: "T_OTHER" });
    const response = await GET(request());
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.searchParams.get("slackBot")).toBe("error");
    expect(location.searchParams.get("reason")).toBe("workspace_mismatch");
    expect(slackApp.save).not.toHaveBeenCalled();
    expect(intake.setMode).not.toHaveBeenCalled();
  });
});
