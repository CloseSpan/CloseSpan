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

export function githubActionsRunnerLabel(
  executor: GithubActionsExecutor,
): string {
  // Execution profiles persist the reviewed provider label. Tenki's
  // documented labels (including tenki-macos-15-* and tenki-macos-26-*) are
  // valid GitHub Actions `runs-on` values and must reach the workflow intact.
  return executor.runnerLabel;
}
