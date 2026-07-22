export function redactUntrustedText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[REDACTED_PHONE]")
    .replace(
      /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED_SECRET]",
    )
    .slice(0, 8_000);
}
