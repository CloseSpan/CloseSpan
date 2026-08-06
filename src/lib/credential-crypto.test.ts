import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  credentialVaultConfigured,
  decryptCredential,
  decryptRuntimeSecret,
  encryptCredential,
  encryptRuntimeSecret,
} from "./credential-crypto";

describe("AI credential encryption", () => {
  beforeEach(() => { process.env.AI_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32,7).toString("base64"); });
  afterEach(() => { delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY; });

  it("encrypts credentials with organization and provider bound as authenticated data", () => {
    const encrypted = encryptCredential("sk-example-secret-1234","org_northstar","openai");
    expect(encrypted.ciphertext).not.toContain("sk-example");
    expect(encrypted.hint).toBe("•••• 1234");
    expect(decryptCredential(encrypted,"org_northstar","openai")).toBe("sk-example-secret-1234");
    expect(() => decryptCredential(encrypted,"org_other","openai")).toThrow(/could not be decrypted/);
    expect(() => decryptCredential(encrypted,"org_northstar","anthropic")).toThrow(/could not be decrypted/);
  });

  it("fails closed when the vault key is missing", () => {
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    expect(credentialVaultConfigured()).toBe(false);
    expect(() => encryptCredential("sk-example-secret-1234","org_northstar","openai")).toThrow(/vault is not initialized/);
  });

  it("binds runtime ciphertext to the organization, secret ID, and exact version", () => {
    const encrypted = encryptRuntimeSecret(
      "runtime-value",
      "org_northstar",
      "d53e4d93-d274-48f6-93a2-4f826fd3a4df",
      3,
    );

    expect(encrypted).not.toHaveProperty("fingerprint");
    expect(encrypted).not.toHaveProperty("hint");
    expect(decryptRuntimeSecret(
      encrypted,
      "org_northstar",
      "d53e4d93-d274-48f6-93a2-4f826fd3a4df",
      3,
    )).toBe("runtime-value");
    expect(() => decryptRuntimeSecret(
      encrypted,
      "org_other",
      "d53e4d93-d274-48f6-93a2-4f826fd3a4df",
      3,
    )).toThrow(/could not be decrypted/);
    expect(() => decryptRuntimeSecret(
      encrypted,
      "org_northstar",
      "d53e4d93-d274-48f6-93a2-4f826fd3a4df",
      4,
    )).toThrow(/could not be decrypted/);
  });
});
