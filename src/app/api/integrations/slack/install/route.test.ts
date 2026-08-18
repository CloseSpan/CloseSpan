import { beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({ admin: vi.fn() }));
const intake = vi.hoisted(() => ({ status: vi.fn() }));
const slackApp = vi.hoisted(() => ({
  configured: vi.fn(),
  buildUrl: vi.fn(),
}));

vi.mock("@/lib/request-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/request-security")>();
  return { ...actual, authorizeAdminMutation: security.admin };
});
vi.mock("@/lib/slack-intake", () => ({
  getSlackIntakeStatus: intake.status,
}));
vi.mock("@/lib/slack-app-repository", () => ({
  slackAppConfigured: slackApp.configured,
  buildSlackInstallUrl: slackApp.buildUrl,
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

describe("CloseSpan Slack app install API", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "slack-route-test-secret-with-at-least-32-characters");
    security.admin.mockReset().mockResolvedValue({
      orgId: "org_test",
      actorId: "admin_test",
    });
    intake.status.mockReset().mockResolvedValue({ state: "Connected" });
    slackApp.configured.mockReset().mockReturnValue(true);
    slackApp.buildUrl.mockReset().mockReturnValue(
      "https://slack.com/oauth/v2/authorize?state=signed-state",
    );
  });

  it("starts an authenticated Slack install and sets a callback cookie", async () => {
    const response = await POST(
      new NextRequest(
        "https://www.closespan.com/api/integrations/slack/install",
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "closespan_slack_install=",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(slackApp.buildUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri:
          "https://www.closespan.com/api/integrations/slack/callback",
      }),
    );
  });

  it("refuses installation until Slack feedback is connected", async () => {
    intake.status.mockResolvedValue(null);
    const response = await POST(
      new NextRequest(
        "https://www.closespan.com/api/integrations/slack/install",
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(409);
    expect(slackApp.buildUrl).not.toHaveBeenCalled();
  });
});
