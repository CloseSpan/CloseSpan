import { createHash } from "node:crypto";

const REDACTED_RUNTIME_SECRET = "[REDACTED_RUNTIME_SECRET]";

function unicodeEscaped(value: string): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0)!;
      if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, "0")}`;
      const adjusted = codePoint - 0x10000;
      const high = 0xd800 + (adjusted >> 10);
      const low = 0xdc00 + (adjusted & 0x3ff);
      return `\\u${high.toString(16).padStart(4, "0")}\\u${low.toString(16).padStart(4, "0")}`;
    })
    .join("");
}

function encodedVariants(value: string): string[] {
  const variants = new Set<string>([value]);
  const bytes = Buffer.from(value, "utf8");
  try {
    variants.add(encodeURIComponent(value));
  } catch {
    // The original exact value is still protected.
  }
  variants.add(bytes.toString("base64"));
  variants.add(bytes.toString("base64url"));
  variants.add(bytes.toString("hex"));
  variants.add(bytes.toString("hex").toUpperCase());
  variants.add(JSON.stringify(value).slice(1, -1));
  variants.add(unicodeEscaped(value));
  variants.add(createHash("sha256").update(bytes).digest("hex"));
  return [...variants].filter((candidate) => candidate.length >= 4);
}

export interface RuntimeSecretRedactor {
  redact(value: string): string;
  contains(value: string): boolean;
  values: readonly string[];
}

export function createRuntimeSecretRedactor(
  secretValues: Iterable<string>,
): RuntimeSecretRedactor {
  const values = [...new Set(
    [...secretValues]
      .filter((value) => value.length >= 4)
      .flatMap(encodedVariants),
  )].sort((left, right) => right.length - left.length);

  return {
    values,
    contains(value: string): boolean {
      return values.some((secret) => value.includes(secret));
    },
    redact(value: string): string {
      let redacted = value;
      for (const secret of values) {
        redacted = redacted.replaceAll(secret, REDACTED_RUNTIME_SECRET);
      }
      return redacted;
    },
  };
}

export function redactRuntimeSecrets(
  value: string,
  secretValues: Iterable<string>,
): string {
  return createRuntimeSecretRedactor(secretValues).redact(value);
}

export { REDACTED_RUNTIME_SECRET };
