import { describe, expect, it } from "vitest";
import {
  createDiscordInstallStateToken,
  verifyDiscordInstallStateToken,
} from "./discord-app-state";

const SECRET = "discord-state-test-secret-that-is-long-enough";
const NOW = new Date("2026-08-22T18:00:00.000Z");

describe("Discord installation state", () => {
  it("round-trips the workspace and installer through a signed token", () => {
    const token = createDiscordInstallStateToken(
      { orgId: "org_zup", actorId: "user_admin" },
      NOW,
      SECRET,
    );

    expect(verifyDiscordInstallStateToken(token, NOW, SECRET)).toMatchObject({
      version: 1,
      orgId: "org_zup",
      actorId: "user_admin",
    });
  });

  it("rejects tampered and expired installation requests", () => {
    const token = createDiscordInstallStateToken(
      { orgId: "org_zup", actorId: "user_admin" },
      NOW,
      SECRET,
    );
    const [payload, signature] = token.split(".");

    expect(() =>
      verifyDiscordInstallStateToken(`${payload}x.${signature}`, NOW, SECRET),
    ).toThrow("Invalid Discord installation state");
    expect(() =>
      verifyDiscordInstallStateToken(
        token,
        new Date("2026-08-22T18:11:00.000Z"),
        SECRET,
      ),
    ).toThrow("Discord installation request expired");
  });
});
