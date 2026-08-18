import { describe, expect, it } from "vitest";
import {
  createSlackInstallStateToken,
  verifySlackInstallStateToken,
} from "./slack-app-state";

const secret = "slack-install-test-secret-with-at-least-32-characters";

describe("Slack installation state", () => {
  it("binds a short-lived install request to one workspace administrator", () => {
    const now = new Date("2026-08-18T20:00:00.000Z");
    const token = createSlackInstallStateToken(
      { orgId: "org_test", actorId: "admin_test" },
      now,
      secret,
    );

    expect(verifySlackInstallStateToken(token, now, secret)).toMatchObject({
      orgId: "org_test",
      actorId: "admin_test",
    });
  });

  it("rejects tampered and expired install requests", () => {
    const now = new Date("2026-08-18T20:00:00.000Z");
    const token = createSlackInstallStateToken(
      { orgId: "org_test", actorId: "admin_test" },
      now,
      secret,
    );

    expect(() =>
      verifySlackInstallStateToken(`${token}x`, now, secret),
    ).toThrow(/Invalid Slack installation state/);
    expect(() =>
      verifySlackInstallStateToken(
        token,
        new Date("2026-08-18T20:11:00.000Z"),
        secret,
      ),
    ).toThrow(/expired/);
  });
});
