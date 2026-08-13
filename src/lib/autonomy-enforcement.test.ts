import { describe, expect, it } from "vitest";
import {
  generateImplementationPrompt,
  generatePddAcceptanceContract,
  requestImplementationApproval,
} from "./engineering-workflow-repository";
import { primaryProblem } from "./seed";
import { updateWorkspacePolicy } from "./workspace-settings-repository";

const actor = {
  actorId: "admin",
  actorName: "Admin",
  traceId: "autonomy-enforcement",
  idempotencyKey: "autonomy-enforcement",
};

function policy(autonomyLevel: "Observe" | "Recommend") {
  return {
    autonomyLevel,
    piiRedaction: true,
    retentionDays: 365,
    priorityWeights: { confidence: 100 },
    promptDraftPolicy: {
      mode: "automatic" as const,
      bugReports: true,
      featureRequests: true,
      minimumEvidence: 1,
      minimumConfidence: 0.5,
      inAppNotifications: true,
      emailNotifications: false,
      reviewerId: null,
    },
  };
}

describe("autonomy workflow enforcement", () => {
  it("prevents Observe workspaces from preparing implementation prompts", async () => {
    const orgId = "org_observe_enforcement";
    await updateWorkspacePolicy(orgId, policy("Observe"), actor);
    await expect(generateImplementationPrompt(orgId, primaryProblem.id, actor))
      .rejects.toThrow("Prompt preparation is disabled");
  });

  it("lets Recommend prepare a Prompt Testing contract but blocks agent execution", async () => {
    const orgId = "org_recommend_enforcement";
    await updateWorkspacePolicy(orgId, policy("Recommend"), actor);
    const prepared = await generatePddAcceptanceContract(
      orgId,
      primaryProblem.id,
      "As an analyst, I want large exports to contain every selected row, so that customer reporting completes reliably.",
      actor,
    );
    expect(prepared.workflow.verification?.status).toBe("Ready for approval");
    expect(prepared.workflow.approval).toBeNull();
    await expect(requestImplementationApproval(orgId, prepared.workflow.prompt!.id, actor))
      .rejects.toThrow("Agent execution is disabled");
  });
});
