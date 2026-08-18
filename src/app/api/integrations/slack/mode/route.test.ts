import { beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({ admin: vi.fn() }));
const intake = vi.hoisted(() => ({ setMode: vi.fn() }));

vi.mock("@/lib/request-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/request-security")>();
  return { ...actual, authorizeAdminMutation: security.admin };
});
vi.mock("@/lib/slack-intake", () => ({
  setSlackIntakeMode: intake.setMode,
}));

import { NextRequest } from "next/server";
import { PATCH } from "./route";

const context = {
  orgId: "org_test",
  actorId: "admin_test",
  actorName: "Admin Test",
  role: "Admin",
  traceId: "trace_test",
};

function request(botEnabled: boolean) {
  return new NextRequest(
    "https://www.closespan.com/api/integrations/slack/mode",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botEnabled }),
    },
  );
}

describe("Slack intake mode API", () => {
  beforeEach(() => {
    security.admin.mockReset().mockResolvedValue(context);
    intake.setMode.mockReset().mockResolvedValue({
      intakeMode: "mentions",
      botInstalled: true,
      botInstallAvailable: true,
    });
  });

  it("enables mention-only intake for the workspace", async () => {
    const response = await PATCH(request(true));

    expect(response.status).toBe(200);
    expect(intake.setMode).toHaveBeenCalledWith({
      orgId: "org_test",
      mode: "mentions",
      actor: context,
    });
  });

  it("restores full-channel monitoring when the bot is turned off", async () => {
    await PATCH(request(false));

    expect(intake.setMode).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "channel" }),
    );
  });
});
