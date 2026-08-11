const EXPLICIT_MALFUNCTION_PATTERNS = [
  /\bdoes(?:n['’]?t| not) work\b/i,
  /\bdid(?:n['’]?t| not) work\b/i,
  /\bnot working\b/i,
  /\bstopp?ed working\b/i,
  /\bnon[-\s]?functional\b/i,
  /\bmalfunction(?:s|ed|ing)?\b/i,
  /\bbroken\b/i,
  /\bfails? to\b/i,
  /\bfailed to\b/i,
] as const;

/**
 * Returns true only for explicit malfunction language. This deliberately does
 * not match broad phrases such as "I can't find" or "hard to use", which can
 * be usability feedback rather than a software defect.
 */
export function hasExplicitMalfunctionSignal(text: string): boolean {
  return EXPLICIT_MALFUNCTION_PATTERNS.some((pattern) => pattern.test(text));
}
