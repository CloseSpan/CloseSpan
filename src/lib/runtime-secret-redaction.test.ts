import { describe, expect, it } from "vitest";
import {
  REDACTED_RUNTIME_SECRET,
  createRuntimeSecretRedactor,
} from "./runtime-secret-redaction";

describe("runtime secret redaction", () => {
  it("redacts exact and common reversible or fingerprinted forms before persistence", () => {
    const secret = "postgres://user:p@ss@example.test/database";
    const redactor = createRuntimeSecretRedactor([secret]);
    const output = redactor.redact([
      secret,
      encodeURIComponent(secret),
      Buffer.from(secret).toString("base64"),
      Buffer.from(secret).toString("hex"),
      Buffer.from(secret).toString("hex").toUpperCase(),
    ].join("\n"));
    expect(output).not.toContain("postgres://");
    expect(output).not.toContain("postgres%3A");
    expect(output.match(new RegExp(`\\${REDACTED_RUNTIME_SECRET}`, "g"))?.length).toBe(5);
  });

  it("ignores empty and tiny values to avoid corrupting ordinary logs", () => {
    const redactor = createRuntimeSecretRedactor(["", "a", "abc"]);
    expect(redactor.redact("a basic trace")).toBe("a basic trace");
  });

  it("preserves leading and trailing whitespace as part of the encrypted secret", () => {
    const redactor = createRuntimeSecretRedactor(["  padded-secret  "]);
    expect(redactor.redact("value=  padded-secret  ")).toBe(
      `value=${REDACTED_RUNTIME_SECRET}`,
    );
    expect(redactor.redact("padded-secret")).toBe("padded-secret");
  });

  it("detects exact and encoded secrets before a generated file can be published", () => {
    const redactor = createRuntimeSecretRedactor(["custom-runtime-credential"]);
    expect(redactor.contains("token=custom-runtime-credential")).toBe(true);
    expect(redactor.contains(
      `token=${Buffer.from("custom-runtime-credential").toString("base64")}`,
    )).toBe(true);
    expect(redactor.contains(
      `token=${Buffer.from("custom-runtime-credential").toString("hex")}`,
    )).toBe(true);
    expect(redactor.contains("export const safe = true")).toBe(false);
  });
});
