import type {
  AgentRunSummaryView,
  AgentRunView,
} from "./engineering-workflow-repository";

export interface AgentRunVerificationState {
  className: string;
  label: "Verified" | "Failed" | "Verifying" | "Not run" | "Pending";
}

const TERMINAL_WITHOUT_VERIFICATION = new Set<AgentRunSummaryView["status"]>([
  "Failed",
  "Cancelled",
  "No changes",
]);

export function agentRunVerificationState(
  run: AgentRunSummaryView,
): AgentRunVerificationState {
  if (run.independentVerificationStatus === "passed") {
    return { className: "badge success", label: "Verified" };
  }
  if (run.independentVerificationStatus === "failed") {
    return { className: "badge high", label: "Failed" };
  }
  if (run.status === "Tests passed") {
    return { className: "badge medium", label: "Verifying" };
  }
  if (TERMINAL_WITHOUT_VERIFICATION.has(run.status)) {
    return { className: "badge", label: "Not run" };
  }
  return { className: "badge", label: "Pending" };
}

export interface AgentRunVerificationExplanation {
  title: string;
  message: string;
}

export function agentRunVerificationExplanation(
  run: Pick<
    AgentRunView,
    "status" | "failureCode" | "failureMessage" | "repository" | "baseBranch" | "baseSha"
  >,
): AgentRunVerificationExplanation | null {
  if (!TERMINAL_WITHOUT_VERIFICATION.has(run.status)) return null;

  if (
    run.failureCode === "stale_base"
    || run.failureMessage?.startsWith("stale_base:")
  ) {
    const repository = run.repository ?? "The repository";
    const branch = run.baseBranch ?? "approved base";
    const commit = run.baseSha ? ` This approval was pinned to commit ${run.baseSha.slice(0, 12)}.` : "";
    return {
      title: "Why verification did not run",
      message: `${repository}’s ${branch} branch changed after approval.${commit} CloseSpan refused to execute against code that was not part of the approval. Prepare another coding run to use the latest branch.`,
    };
  }

  if (run.status === "Cancelled") {
    return {
      title: "Why verification did not run",
      message: "The coding run was cancelled before independent verification could start. Prepare another coding run when you are ready to try again.",
    };
  }

  if (run.status === "No changes") {
    return {
      title: "Why verification did not run",
      message: "The coding run completed without product-code changes, so there was no implementation for CloseSpan to verify. Review the run before preparing another coding run.",
    };
  }

  return {
    title: "Why verification did not run",
    message: "The coding run failed before independent verification could start. Review the failure above, resolve its cause, then prepare another coding run.",
  };
}
