import type { AgentRunSummaryView } from "./engineering-workflow-repository";

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
