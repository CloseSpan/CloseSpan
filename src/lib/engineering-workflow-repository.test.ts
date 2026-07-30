import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_ID, primaryProblem } from "./seed";
import {
  approveImplementationRun,
  generateImplementationPrompt,
  getEngineeringWorkflow,
  rejectImplementationApproval,
  requestImplementationApproval,
  resetMemoryEngineeringWorkflows,
  saveEngineeringSpecification,
  testUserStoryAgainstPrompt,
} from "./engineering-workflow-repository";

const actor = { actorId: "admin", actorName: "Admin", traceId: "trace", idempotencyKey: "workflow_test_1" };

describe("approval-bound engineering workflow", () => {
  beforeEach(() => resetMemoryEngineeringWorkflows());
  afterEach(() => vi.useRealTimers());

  it("consumes one approval exactly once", async () => {
    const promptWorkflow = await generateImplementationPrompt(ORG_ID, primaryProblem.id, actor);
    const approvalWorkflow = await requestImplementationApproval(ORG_ID, promptWorkflow.prompt!.id, actor);
    const approved = await approveImplementationRun(ORG_ID, approvalWorkflow.approval!.id, actor);
    expect(approved.run?.status).toBe("Queued");
    await expect(approveImplementationRun(ORG_ID, approvalWorkflow.approval!.id, actor)).rejects.toThrow("no longer pending");
  });

  it("does not create a second approval for a prompt that is already awaiting approval", async () => {
    const promptWorkflow = await generateImplementationPrompt(ORG_ID, primaryProblem.id, actor);
    const first = await requestImplementationApproval(ORG_ID, promptWorkflow.prompt!.id, actor);

    await expect(
      requestImplementationApproval(ORG_ID, promptWorkflow.prompt!.id, actor),
    ).rejects.toThrow("Only the latest ready prompt can be submitted");
    expect((await getEngineeringWorkflow(ORG_ID, primaryProblem.id)).approval?.id)
      .toBe(first.approval?.id);
  });

  it("returns a rejected prompt to Ready so the same immutable revision can be resubmitted", async () => {
    const promptWorkflow = await generateImplementationPrompt(ORG_ID, primaryProblem.id, actor);
    const awaiting = await requestImplementationApproval(ORG_ID, promptWorkflow.prompt!.id, actor);
    const rejected = await rejectImplementationApproval(ORG_ID, awaiting.approval!.id, actor);

    expect(rejected.prompt).toMatchObject({ id: promptWorkflow.prompt!.id, revision: 1, status: "Ready" });
    expect(rejected.approval?.status).toBe("Rejected");
    const resubmitted = await requestImplementationApproval(ORG_ID, promptWorkflow.prompt!.id, actor);
    expect(resubmitted.prompt?.revision).toBe(1);
    expect(resubmitted.approval?.status).toBe("Pending");
  });

  it("returns an expired prompt to Ready so it can be resubmitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00Z"));
    const promptWorkflow = await generateImplementationPrompt(ORG_ID, primaryProblem.id, actor);
    const awaiting = await requestImplementationApproval(ORG_ID, promptWorkflow.prompt!.id, actor);
    vi.advanceTimersByTime(31 * 60_000);

    await expect(approveImplementationRun(ORG_ID, awaiting.approval!.id, actor))
      .rejects.toThrow("Approval expired");
    const expired = await getEngineeringWorkflow(ORG_ID, primaryProblem.id);
    expect(expired.prompt?.status).toBe("Ready");
    expect(expired.approval?.status).toBe("Expired");
    expect((await requestImplementationApproval(ORG_ID, promptWorkflow.prompt!.id, actor)).approval?.status)
      .toBe("Pending");
  });

  it("invalidates the prompt and pending approval when the ticket changes", async () => {
    const promptWorkflow = await generateImplementationPrompt(ORG_ID, primaryProblem.id, actor);
    const awaiting = await requestImplementationApproval(ORG_ID, promptWorkflow.prompt!.id, actor);
    const edited = structuredClone(awaiting.specification!);
    edited.expectedBehavior += " Completion telemetry records the final row count.";
    const result = await saveEngineeringSpecification(ORG_ID, primaryProblem.id, edited, actor);
    expect(result.prompt?.status).toBe("Superseded");
    expect(result.approval?.status).toBe("Superseded");
    expect(result.specification?.implementationState).toBe("Draft specification");
  });

  it("keeps release evidence distinct from implementation tests", async () => {
    const workflow = await getEngineeringWorkflow(ORG_ID, primaryProblem.id);
    expect(workflow.specification?.implementationState).toBe("Draft specification");
    expect(workflow.releaseEvidence).toBeNull();
  });

  it("generates a missing prompt and tests one user-story input", async () => {
    const initial = await getEngineeringWorkflow(ORG_ID, primaryProblem.id);
    const story = initial.specification!.userStory;
    const first = await testUserStoryAgainstPrompt(
      ORG_ID,
      primaryProblem.id,
      story,
      actor,
    );
    expect(first.storyTest).toMatchObject({
      status: "included",
    });
    expect(first.workflow.approval?.status).toBe("Pending");
    expect(first.workflow.prompt?.status).toBe("Awaiting approval");
    expect(first.workflow.prompt?.content).toContain(`## User story\n<user_story>\n${story}\n</user_story>`);

    const repeated = await testUserStoryAgainstPrompt(
      ORG_ID,
      primaryProblem.id,
      story,
      actor,
    );
    expect(repeated.workflow.prompt?.id).toBe(first.workflow.prompt?.id);
    expect(repeated.workflow.prompt?.revision).toBe(1);
    expect(repeated.workflow.approval?.id).toBe(first.workflow.approval?.id);
  });

  it("rejects a vague story without changing prompt state", async () => {
    await expect(
      testUserStoryAgainstPrompt(
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
    const first = await testUserStoryAgainstPrompt(
      ORG_ID,
      primaryProblem.id,
      initial.specification!.userStory,
      actor,
    );
    const tested = await testUserStoryAgainstPrompt(
      ORG_ID,
      primaryProblem.id,
      "As an analyst, I want large exports to preserve every row so that scheduled reports stay accurate.",
      actor,
    );
    expect(tested.storyTest.status).toBe("not-included");
    expect(tested.workflow.prompt?.id).toBe(first.workflow.prompt?.id);
    expect(tested.workflow.prompt?.revision).toBe(1);
    expect(tested.workflow.approval?.status).toBe("Pending");
    expect(tested.workflow.specification?.userStory).toBe(
      initial.specification!.userStory,
    );
  });
});
