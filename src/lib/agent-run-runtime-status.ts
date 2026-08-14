import type { AgentRunView } from "./engineering-workflow-repository";

type RuntimeEvidenceStatus = Pick<
  NonNullable<AgentRunView["runtimeEvidence"]>,
  "configured" | "healthStatus" | "userStoryReplay"
>;

export type RuntimeVerificationState = "passed" | "failed" | "pending" | "not-configured";

const activeRunStatuses = new Set<AgentRunView["status"]>([
  "Queued",
  "Running",
  "Tests passed",
]);

export function getRuntimeVerificationState(
  runStatus: AgentRunView["status"],
  runtime: RuntimeEvidenceStatus | undefined,
): RuntimeVerificationState {
  if (runtime?.healthStatus === "passed" && runtime.userStoryReplay !== "failed") {
    return "passed";
  }

  if (runtime?.healthStatus === "failed" || runtime?.userStoryReplay === "failed") {
    return "failed";
  }

  if (runtime?.configured || activeRunStatuses.has(runStatus)) {
    return "pending";
  }

  return "not-configured";
}

export function getRuntimeVerificationLabel(state: RuntimeVerificationState): string {
  switch (state) {
    case "passed":
      return "Runtime passed";
    case "failed":
      return "Runtime failed";
    case "pending":
      return "Runtime pending";
    case "not-configured":
      return "Not configured";
  }
}

export function getRuntimeVerificationBadgeClass(
  state: RuntimeVerificationState,
): "success" | "high" | "medium" {
  if (state === "passed") return "success";
  if (state === "failed") return "high";
  return "medium";
}
