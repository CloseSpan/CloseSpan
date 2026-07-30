import { describe, expect, it } from "vitest";
import {
  createGithubInstallStateToken,
  verifyGithubInstallStateToken,
} from "./github-installation-state";

const secret = "github-install-state-test-secret-with-32-characters";
const attemptId = "11111111-1111-4111-8111-111111111111";

describe("GitHub installation state", () => {
  it("round-trips a signed unexpired installation attempt", () => {
    const expiresAt = new Date("2030-01-01T00:10:00.000Z");
    const token = createGithubInstallStateToken(attemptId, expiresAt, secret);
    expect(
      verifyGithubInstallStateToken(
        token,
        new Date("2030-01-01T00:00:00.000Z"),
        secret,
      ),
    ).toEqual({ version: 1, attemptId, expiresAt: expiresAt.toISOString() });
  });

  it("rejects modified and expired state", () => {
    const expiresAt = new Date("2030-01-01T00:10:00.000Z");
    const token = createGithubInstallStateToken(attemptId, expiresAt, secret);
    expect(() =>
      verifyGithubInstallStateToken(`${token}x`, new Date("2030-01-01T00:00:00Z"), secret),
    ).toThrow("Invalid GitHub installation state");
    expect(() =>
      verifyGithubInstallStateToken(token, new Date("2030-01-01T00:10:00Z"), secret),
    ).toThrow("expired");
  });
});
