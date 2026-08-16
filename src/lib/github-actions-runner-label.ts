import type { ExecutionProfileExecutor } from "./execution-profile";

export type GithubActionsRunnerProvider = "tenki" | "github_hosted";

const RUNNER_LABEL_PATTERN = /^[A-Za-z0-9_.-]{1,120}$/;

export function assertGithubActionsRunnerLabel(label: string): void {
  if (!RUNNER_LABEL_PATTERN.test(label)) {
    throw new Error("Select a valid GitHub Actions runner label");
  }
}

export function runnerProviderForLabel(label: string): GithubActionsRunnerProvider {
  return /^tenki-/i.test(label) ? "tenki" : "github_hosted";
}

type GithubActionsExecutor = Extract<
  ExecutionProfileExecutor,
  { kind: "tenki_github_actions" }
>;

// Profiles created before runner inventory discovery stored these values as
// capacity selectors rather than actual `runs-on` labels. Preserve that legacy
// behavior for immutable historical profiles; new profiles store the selected
// Tenki or GitHub-hosted label directly.
const MACOS_CAPACITY_SELECTOR =
  /^tenki-macos-(?<version>[0-9]{2})-(?:mini|small|medium|large)$/;

export function githubActionsRunnerLabel(
  executor: GithubActionsExecutor,
): string {
  if (executor.platform !== "macos") return executor.runnerLabel;
  const match = MACOS_CAPACITY_SELECTOR.exec(executor.runnerLabel);
  if (!match) return executor.runnerLabel;

  // Legacy capacity selectors did not identify an enabled Tenki runner. Route
  // them explicitly to the compatible hosted image until they are superseded
  // by a newly detected, inventory-backed profile.
  const requiredXcodeMajor = executor.xcode
    ? Number.parseInt(executor.xcode.version.split(".")[0] || "", 10)
    : Number.NaN;
  if (Number.isFinite(requiredXcodeMajor) && requiredXcodeMajor >= 26) {
    return `macos-${requiredXcodeMajor}`;
  }

  return match?.groups?.version
    ? `macos-${match.groups.version}`
    : executor.runnerLabel;
}
