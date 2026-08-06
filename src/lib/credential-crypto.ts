import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export interface EncryptedCredential {
  ciphertext: string;
  iv: string;
  authTag: string;
  hint: string;
  fingerprint: string;
}

export interface EncryptedRuntimeSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyId: "v1";
}

export class CredentialVaultConfigurationError extends Error {}
export class CredentialDecryptionError extends Error {}

function encryptionKey(): Buffer {
  const configured = process.env.AI_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!configured)
    throw new CredentialVaultConfigurationError(
      "The AI credential vault is not initialized. Set AI_CREDENTIAL_ENCRYPTION_KEY and restart the app.",
    );
  const key = /^[a-f\d]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32)
    throw new CredentialVaultConfigurationError(
      "AI_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  return key;
}

export function credentialVaultConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

function additionalData(orgId: string, provider: string): Buffer {
  return Buffer.from(`feedbackflow-ai:v1:${orgId}:${provider}`, "utf8");
}

function encryptAuthenticatedValue(
  value: string,
  authenticatedData: Buffer,
): Pick<EncryptedCredential, "ciphertext" | "iv" | "authTag"> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(authenticatedData);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptAuthenticatedValue(
  input: { ciphertext: string; iv: string; authTag: string },
  authenticatedData: Buffer,
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(input.iv, "base64"),
  );
  decipher.setAAD(authenticatedData);
  decipher.setAuthTag(Buffer.from(input.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(input.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptCredential(
  apiKey: string,
  orgId: string,
  provider: string,
): EncryptedCredential {
  const encrypted = encryptAuthenticatedValue(
    apiKey,
    additionalData(orgId, provider),
  );
  return {
    ...encrypted,
    hint: `•••• ${apiKey.slice(-4)}`,
    fingerprint: createHash("sha256").update(apiKey).digest("hex").slice(0, 16),
  };
}

export function decryptCredential(
  input: { ciphertext: string; iv: string; authTag: string },
  orgId: string,
  provider: string,
): string {
  try {
    return decryptAuthenticatedValue(input, additionalData(orgId, provider));
  } catch (error) {
    if (error instanceof CredentialVaultConfigurationError) throw error;
    throw new CredentialDecryptionError(
      "The stored AI credential could not be decrypted with the configured vault key.",
    );
  }
}

function runtimeSecretAdditionalData(
  orgId: string,
  secretId: string,
  version: number,
): Buffer {
  return Buffer.from(
    `closespan-runtime-secret:v1:${orgId}:${secretId}:${version}`,
    "utf8",
  );
}

export function encryptRuntimeSecret(
  value: string,
  orgId: string,
  secretId: string,
  version: number,
): EncryptedRuntimeSecret {
  return {
    ...encryptAuthenticatedValue(
      value,
      runtimeSecretAdditionalData(orgId, secretId, version),
    ),
    keyId: "v1",
  };
}

export function decryptRuntimeSecret(
  input: {
    ciphertext: string;
    iv: string;
    authTag: string;
    keyId: string;
  },
  orgId: string,
  secretId: string,
  version: number,
): string {
  if (input.keyId !== "v1") {
    throw new CredentialDecryptionError(
      "The stored runtime secret uses an unsupported encryption key version.",
    );
  }
  try {
    return decryptAuthenticatedValue(
      input,
      runtimeSecretAdditionalData(orgId, secretId, version),
    );
  } catch (error) {
    if (error instanceof CredentialVaultConfigurationError) throw error;
    throw new CredentialDecryptionError(
      "The stored runtime secret could not be decrypted with the configured vault key.",
    );
  }
}
