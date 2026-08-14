import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_ID, primaryProblem } from "./seed";
import {
  applyPddPromptRevision,
  approveImplementationRun,
  failAgentRun,
  getPromptAlignmentContext,
  getEngineeringWorkflow,
  rejectImplementationApproval,
  requestImplementationApproval,
  resetMemoryEngineeringWorkflows,
  saveEngineeringSpecification,
  generatePddAcceptanceContract,
} from "./engineering-workflow-repository";

const actor = { actorId: "admin", actorName: "Admin", traceId: "trace", idempotencyKey: "workflow_test_1" };

async function prepareApproval() {
  const initial = await getEngineeringWorkflow(ORG_ID, primaryProblem.id);
  return generatePddAcceptanceContract(
    ORG_ID,
    primaryProblem.id,
    initial.specification!.userStory,
    actor,
  ).then((result) => result.workflow);
}

describe("approval-bound engineering workflow", () => {
  beforeEach(() => resetMemoryEngineeringWorkflows());
  afterEach(() => vi.useRealTimers());

  it("consumes one approval exactly once", async () => {
    const approvalWorkflow = await prepareApproval();
    const approved = await approveImplementationRun(ORG_ID, approvalWorkflow.approval!.id, actor);
    expect(approved.run?.status).toBe("Queued");
    await expect(approveImplementationRun(ORG_ID, approvalWorkflow.approval!.id, actor)).rejects.toThrow("no longer pending");
  });

  it("does not create a second approval for a prompt that is already awaiting approval", async () => {
    const first = await prepareApproval();

    await expect(
      requestImplementationApproval(ORG_ID, first.prompt!.id, actor),
    ).rejects.toThrow("Only the latest ready prompt can be submitted");
    expect((await getEngineeringWorkflow(ORG_ID, primaryProblem.id)).approval?.id)
      .toBe(first.approval?.id);
  });

  it("returns a rejected prompt to Ready so the same immutable revision can be resubmitted", async () => {
    const awaiting = await prepareApproval();
    const rejected = await rejectImplementationApproval(ORG_ID, awaiting.approval!.id, actor);

    expect(rejected.prompt).toMatchObject({ id: awaiting.prompt!.id, revision: 1, status: "Ready" });
    expect(rejected.approval?.status).toBe("Rejected");
    const resubmitted = await requestImplementationApproval(ORG_ID, awaiting.prompt!.id, actor);
    expect(resubmitted.prompt?.revision).toBe(1);
    expect(resubmitted.approval?.status).toBe("Pending");
  });

  it("returns an expired prompt to Ready so it can be resubmitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00Z"));
    const awaiting = await prepareApproval();
    vi.advanceTimersByTime(31 * 60_000);

    await expect(approveImplementationRun(ORG_ID, awaiting.approval!.id, actor))
      .rejects.toThrow("Approval expired");
    const expired = await getEngineeringWorkflow(ORG_ID, primaryProblem.id);
    expect(expired.prompt?.status).toBe("Ready");
    expect(expired.approval?.status).toBe("Expired");
    expect((await requestImplementationApproval(ORG_ID, awaiting.prompt!.id, actor)).approval?.status)
      .toBe("Pending");
  });

  it("reopens a failed one-run prompt and creates a fresh approval for the same immutable contract", async () => {
    const awaiting = await prepareApproval();
    const approved = await approveImplementationRun(ORG_ID, awaiting.approval!.id, actor);
    await failAgentRun({
      orgId: ORG_ID,
      problemId: primaryProblem.id,
      runId: approved.run!.id,
      promptId: approved.prompt!.id,
    } as Parameters<typeof failAgentRun>[0], "executor_failed", "The coding run stopped.");

    const failed = await getEngineeringWorkflow(ORG_ID, primaryProblem.id);
    expect(failed.run?.status).toBe("Failed");
    expect(failed.prompt?.status).toBe("Ready");

    // Simulate a run that failed before older deployments repaired prompt state.
    const memory = (globalThis as typeof globalThis & {
      __closeSpanEngineeringWorkflows?: Map<string, { prompt?: { status: string } }>;
    }).__closeSpanEngineeringWorkflows;
    memory!.get(`${ORG_ID}:${primaryProblem.id}`)!.prompt!.status = "Approved";
    const alignment = await getPromptAlignmentContext(
      ORG_ID,
      primaryProblem.id,
      failed.specification!.userStory,
      actor,
    );
    expect(alignment.workflow.prompt?.status).toBe("Ready");

    const retried = await generatePddAcceptanceContract(
      ORG_ID,
      primaryProblem.id,
      failed.specification!.userStory,
      actor,
    );
    expect(retried.workflow.prompt?.id).toBe(awaiting.prompt!.id);
    expect(retried.workflow.prompt?.status).toBe("Awaiting approval");
    expect(retried.workflow.approval?.status).toBe("Pending");
    expect(retried.workflow.approval?.id).not.toBe(awaiting.approval!.id);
  });

  it("rejects ticket mutation while an implementation approval is pending", async () => {
    const awaiting = await prepareApproval();
    const edited = structuredClone(awaiting.specification!);
    edited.expectedBehavior += " Completion telemetry records the final row count.";
    await expect(saveEngineeringSpecification(ORG_ID, primaryProblem.id, edited, actor))
      .rejects.toThrow("Reject or expire the pending implementation approval");
    const unchanged = await getEngineeringWorkflow(ORG_ID, primaryProblem.id);
    expect(unchanged.prompt?.status).toBe("Awaiting approval");
    expect(unchanged.approval?.status).toBe("Pending");
    expect(unchanged.specification?.expectedBehavior).toBe(awaiting.specification?.expectedBehavior);
  });

  it("keeps release evidence distinct from implementation tests", async () => {
    const workflow = await getEngineeringWorkflow(ORG_ID, primaryProblem.id);
    expect(workflow.specification?.implementationState).toBe("Draft specification");
    expect(workflow.releaseEvidence).toBeNull();
  });

  it("generates a missing prompt and tests one user-story input", async () => {
    const initial = await getEngineeringWorkflow(ORG_ID, primaryProblem.id);
    const story = initial.specification!.userStory;
    const first = await generatePddAcceptanceContract(
      ORG_ID,
      primaryProblem.id,
      story,
      actor,
    );
    expect(first.storyTest).toMatchObject({
      status: "Ready for approval",
    });
    expect(first.workflow.approval?.status).toBe("Pending");
    expect(first.workflow.prompt?.status).toBe("Awaiting approval");
    expect(first.workflow.prompt?.content).toContain(`## User story\n<user_story>\n${story}\n</user_story>`);

    const repeated = await generatePddAcceptanceContract(
      ORG_ID,
      primaryProblem.id,
      story,
      actor,
    );
    expect(repeated.workflow.prompt?.id).toBe(first.workflow.prompt?.id);
    expect(repeated.workflow.prompt?.revision).toBe(1);
    expect(repeated.workflow.approval?.id).toBe(first.workflow.approval?.id);
  });

  it("applies a Prompt Testing-guided prompt as a new immutable revision", async () => {
    const initial = await getEngineeringWorkflow(ORG_ID, primaryProblem.id);
    const generated = await generatePddAcceptanceContract(
      ORG_ID,
      primaryProblem.id,
      initial.specification!.userStory,
      actor,
    );
    await rejectImplementationApproval(
      ORG_ID,
      generated.workflow.approval!.id,
      actor,
    );
    const current = await getEngineeringWorkflow(ORG_ID, primaryProblem.id);
    const revised = `${current.prompt!.content}\n\n## PDD-required outcome\n- The CSV contains every expected row.`;

    const result = await applyPddPromptRevision(ORG_ID, primaryProblem.id, {
      currentPromptHash: current.prompt!.contentHash,
      revisedPrompt: revised,
    }, actor);

    expect(result.prompt).toMatchObject({ revision: 2, status: "Ready", content: revised });
    await expect(applyPddPromptRevision(ORG_ID, primaryProblem.id, {
      currentPromptHash: current.prompt!.contentHash,
      revisedPrompt: `${revised}\n- Preserve headers.`,
    }, actor)).rejects.toThrow("changed; test it again");
  });

  it("rejects a vague story without changing prompt state", async () => {
    await expect(
      generatePddAcceptanceContract(
        ORG_ID,
        primaryProblem.id,
        "Exports should work",
        actor,
      ),
    ).rejects.toThrow("Use the format");
    expect((await getEngineeringWorkflow(ORG_ID, primaryProblem.id)).prompt).toBeNull();
  });

  it("does not rewrite the prompt or approval when a different story is tested", async () => {
    const initial = await getEngineeringWorkflow(ORG_ID, primaryProblem.id);
    const first = await generatePddAcceptanceContract(
      ORG_ID,
      primaryProblem.id,
      initial.specification!.userStory,
      actor,
    );
    await expect(generatePddAcceptanceContract(
      ORG_ID,
      primaryProblem.id,
      "As an analyst, I want large exports to preserve every row so that scheduled reports stay accurate.",
      actor,
    )).rejects.toThrow("pending or consumed approval");
    const tested = await getEngineeringWorkflow(ORG_ID, primaryProblem.id);
    expect(tested.prompt?.id).toBe(first.workflow.prompt?.id);
    expect(tested.prompt?.revision).toBe(1);
    expect(tested.approval?.status).toBe("Pending");
    expect(tested.specification?.userStory).toBe(
      initial.specification!.userStory,
    );
  });
});
