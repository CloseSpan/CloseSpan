import type { Octokit } from "@octokit/rest";

export const RUNTIME_VERIFIER_WORKFLOW_NOT_INSTALLED_MESSAGE =
  "Runtime verifier workflow is not installed. Approve the Tenki setup pull request before running verification.";

export const GITHUB_ACTIONS_BILLING_BLOCKED_MESSAGE =
  "GitHub did not start the verification because recent account payments failed or the Actions spending limit was reached. Resolve the payment or Actions budget in GitHub Billing & plans, then retry runtime verification.";

export const GITHUB_ACTIONS_JOB_NOT_STARTED_MESSAGE =
  "GitHub rejected the verification before assigning a runner. Check the GitHub Actions payment and spending limit first, then confirm a compatible runner is available and retry runtime verification.";

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

const GITHUB_ACTIONS_BILLING_PATTERN =
  /(?:recent account payments? (?:have )?failed|spending limit needs to be increased|billing (?:issue|problem)|actions (?:budget|spending limit))/i;

function annotationFailureMessage(message: string): string | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (GITHUB_ACTIONS_BILLING_PATTERN.test(normalized)) {
    return GITHUB_ACTIONS_BILLING_BLOCKED_MESSAGE;
  }
  return `${normalized.slice(0, 1_700)} Review the GitHub run, correct the failure, then retry runtime verification.`;
}

export async function githubRuntimeVerificationFailureMessage(
  github: Octokit,
  owner: string,
  repo: string,
  workflowRunId: number,
): Promise<string | null> {
  try {
    const jobsResponse = await github.rest.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id: workflowRunId,
      per_page: 100,
    });
    const failedJobs = jobsResponse.data.jobs.filter((job) =>
      job.conclusion && job.conclusion !== "success" && job.conclusion !== "skipped"
    );
    for (const job of failedJobs) {
      try {
        const annotations = await github.rest.checks.listAnnotations({
          owner,
          repo,
          check_run_id: job.id,
          per_page: 100,
        });
        const failureMessage = annotations.data
          .filter((annotation) => annotation.annotation_level === "failure")
          .map((annotation) => annotation.message?.trim())
          .find((message): message is string => Boolean(message))
          ?? annotations.data
            .map((annotation) => annotation.message?.trim())
            .find((message): message is string => Boolean(message));
        if (failureMessage) return annotationFailureMessage(failureMessage);
      } catch {
        // A GitHub App can read Actions without Checks access. Keep looking and
        // fall back to the workflow conclusion when annotations are unavailable.
      }
    }
    if (
      failedJobs.length > 0
      && failedJobs.every((job) =>
        !job.runner_id && (!job.steps || job.steps.length === 0)
      )
    ) {
      return GITHUB_ACTIONS_JOB_NOT_STARTED_MESSAGE;
    }
  } catch {
    // Reconciliation must remain reliable even when GitHub's diagnostics API is unavailable.
  }
  return null;
}
