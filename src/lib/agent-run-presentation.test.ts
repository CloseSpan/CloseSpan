import { describe, expect, it } from "vitest";
import type { AgentRunSummaryView } from "./engineering-workflow-repository";
import { agentRunVerificationState } from "./agent-run-presentation";

function run(
  status: AgentRunSummaryView["status"],
  independentVerificationStatus: AgentRunSummaryView["independentVerificationStatus"] = null,
): AgentRunSummaryView {
  return {
    id: "run_1",
    approvalId: "approval_1",
    problemId: "problem_1",
    problemTitle: "Caption regeneration",
    status,
    repository: "example/product",
    branchName: "closespan/example",
    pullRequestUrl: null,
    queuedAt: "2026-08-14T12:00:00.000Z",
    completedAt: null,
    independentVerificationStatus,
  };
}

describe("agent run verification presentation", () => {
  it.each(["Failed", "Cancelled", "No changes"] as const)(
    "shows Not run when a %s implementation never reached verification",
    (status) => {
      expect(agentRunVerificationState(run(status))).toEqual({
        className: "badge",
        label: "Not run",
      });
    },
  );

  it("keeps queued and running implementations pending", () => {
    expect(agentRunVerificationState(run("Queued")).label).toBe("Pending");
    expect(agentRunVerificationState(run("Running")).label).toBe("Pending");
  });

  it("shows active and completed independent verification states", () => {
    expect(agentRunVerificationState(run("Tests passed")).label).toBe("Verifying");
    expect(agentRunVerificationState(run("Draft PR opened", "passed"))).toEqual({
      className: "badge success",
      label: "Verified",
    });
    expect(agentRunVerificationState(run("Failed", "failed"))).toEqual({
      className: "badge high",
      label: "Failed",
    });
  });
});
