export const RUNTIME_VERIFIER_WORKFLOW_NOT_INSTALLED_MESSAGE =
  "Runtime verifier workflow is not installed. Approve the Tenki setup pull request before running verification.";

const GITHUB_CONTENTS_NOT_FOUND_PATTERN =
  /Not Found\s*-?\s*https:\/\/docs\.github\.com\/rest\/repos\/contents#get-repository-content/i;

export function runtimeVerificationFailureMessage(
  message: string | null,
): string | null {
  if (!message) return null;
  const trimmed = message.trim();
  return GITHUB_CONTENTS_NOT_FOUND_PATTERN.test(trimmed)
    ? RUNTIME_VERIFIER_WORKFLOW_NOT_INSTALLED_MESSAGE
    : trimmed;
}
