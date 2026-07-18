import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { credentialVaultConfigured, decryptCredential, encryptCredential } from "./credential-crypto";

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
});
