import type { ExecutionProfileExecutor } from "./execution-profile";

type GithubActionsExecutor = Extract<
  ExecutionProfileExecutor,
  { kind: "tenki_github_actions" }
>;

// CloseSpan records these macOS values as capacity selectors. They are not
// published Tenki `runs-on` labels, so route them to the matching hosted macOS
// image unless the profile contains an explicitly onboarded custom label.
const MACOS_CAPACITY_SELECTOR =
  /^tenki-macos-(?<version>[0-9]{2})-(?:mini|small|medium|large)$/;

export function githubActionsRunnerLabel(
  executor: GithubActionsExecutor,
): string {
  if (executor.platform !== "macos") return executor.runnerLabel;

  // GitHub's Xcode 26 images are published on the matching macOS major label.
  // A stored capacity selector such as tenki-macos-15-small describes sizing,
  // not Xcode compatibility, and must not force an Xcode 26 profile onto 16.x.
  const requiredXcodeMajor = executor.xcode
    ? Number.parseInt(executor.xcode.version.split(".")[0] || "", 10)
    : Number.NaN;
  if (Number.isFinite(requiredXcodeMajor) && requiredXcodeMajor >= 26) {
    return `macos-${requiredXcodeMajor}`;
  }

  const match = MACOS_CAPACITY_SELECTOR.exec(executor.runnerLabel);
  return match?.groups?.version
    ? `macos-${match.groups.version}`
    : executor.runnerLabel;
}
