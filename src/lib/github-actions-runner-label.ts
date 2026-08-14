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

  const match = MACOS_CAPACITY_SELECTOR.exec(executor.runnerLabel);
  return match?.groups?.version
    ? `macos-${match.groups.version}`
    : executor.runnerLabel;
}
