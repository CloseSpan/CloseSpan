import { describe, expect, it } from "vitest";
import {
  createGithubInstallStateToken,
  verifyGithubInstallStateToken,
  createGithubInstallCompletionToken,
  verifyGithubInstallCompletionToken,
} from "./github-installation-state";

const secret = "github-install-state-test-secret-with-32-characters";
const attemptId = "11111111-1111-4111-8111-111111111111";

describe("GitHub installation state", () => {
  it("round-trips a signed unexpired installation attempt", () => {
    const expiresAt = new Date("2030-01-01T00:10:00.000Z");
    const token = createGithubInstallStateToken(
      attemptId,
      expiresAt,
      "/onboarding",
      secret,
    );
    expect(
      verifyGithubInstallStateToken(
        token,
        new Date("2030-01-01T00:00:00.000Z"),
        secret,
      ),
    ).toEqual({
      version: 1,
      attemptId,
      expiresAt: expiresAt.toISOString(),
      returnTo: "/onboarding",
    });
  });

  it("rejects modified and expired state", () => {
    const expiresAt = new Date("2030-01-01T00:10:00.000Z");
    const token = createGithubInstallStateToken(
      attemptId,
      expiresAt,
      "/integrations",
      secret,
    );
    expect(() =>
      verifyGithubInstallStateToken(`${token}x`, new Date("2030-01-01T00:00:00Z"), secret),
    ).toThrow("Invalid GitHub installation state");
    expect(() =>
      verifyGithubInstallStateToken(token, new Date("2030-01-01T00:10:00Z"), secret),
    ).toThrow("expired");
  });

  it("binds popup mode and its completion channel into signed state", () => {
    const expiresAt = new Date("2030-01-01T00:10:00.000Z");
    const token = createGithubInstallStateToken(attemptId, expiresAt, "/onboarding", secret, { channel: attemptId });
    expect(verifyGithubInstallStateToken(token, new Date("2030-01-01"), secret)).toMatchObject({ popup: true, popupChannel: attemptId });
    const [encoded, signature] = token.split(".");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    payload.popupChannel = "22222222-2222-4222-8222-222222222222";
    expect(() => verifyGithubInstallStateToken(`${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`, new Date("2030-01-01"), secret)).toThrow("Invalid GitHub installation state");
  });

  it("keeps legacy state on ordinary redirects and validates popup channels", () => {
    const expiresAt = new Date("2030-01-01T00:10:00.000Z");
    const token = createGithubInstallStateToken(attemptId, expiresAt, "/integrations", secret);
    expect(verifyGithubInstallStateToken(token, new Date("2030-01-01"), secret).popup).toBeUndefined();
    expect(() => createGithubInstallStateToken(attemptId, expiresAt, "/integrations", secret, { channel: "not-a-channel" })).toThrow("Invalid GitHub popup channel");
  });

  it("accepts only signed, unexpired purpose-bound completion receipts", () => {
    const completion = { channel: attemptId, status: "connected" as const, expiresAt: "2030-01-01T00:02:00.000Z" };
    const token = createGithubInstallCompletionToken(completion, secret);
    expect(verifyGithubInstallCompletionToken(token, new Date("2030-01-01"), secret)).toEqual(completion);
    expect(() => verifyGithubInstallCompletionToken(`${token}x`, new Date("2030-01-01"), secret)).toThrow("Invalid GitHub completion");
    expect(() => verifyGithubInstallCompletionToken(token, new Date("2030-01-01T00:03:00Z"), secret)).toThrow("expired");
    const installState = createGithubInstallStateToken(attemptId, new Date("2030-01-01T00:10:00Z"), "/integrations", secret);
    expect(() => verifyGithubInstallCompletionToken(installState, new Date("2030-01-01"), secret)).toThrow("Invalid or expired GitHub completion");
  });
});
