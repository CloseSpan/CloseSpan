import { beforeEach, describe, expect, it } from "vitest";
import { ORG_ID, primaryProblem } from "./seed";
import {
  approveImplementationRun,
  generateImplementationPrompt,
  getEngineeringWorkflow,
  requestImplementationApproval,
  resetMemoryEngineeringWorkflows,
  saveEngineeringSpecification,
  testUserStoryAgainstPrompt,
} from "./engineering-workflow-repository";

const actor = { actorId: "admin", actorName: "Admin", traceId: "trace", idempotencyKey: "workflow_test_1" };

describe("approval-bound engineering workflow", () => {
  beforeEach(() => resetMemoryEngineeringWorkflows());

  it("consumes one approval exactly once", async () => {
    const promptWorkflow = await generateImplementationPrompt(ORG_ID, primaryProblem.id, actor);
    const approvalWorkflow = await requestImplementationApproval(ORG_ID, promptWorkflow.prompt!.id, actor);
    const approved = await approveImplementationRun(ORG_ID, approvalWorkflow.approval!.id, actor);
    expect(approved.run?.status).toBe("Queued");
    await expect(approveImplementationRun(ORG_ID, approvalWorkflow.approval!.id, actor)).rejects.toThrow("no longer pending");
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
    expect(first.workflow.prompt?.content).toContain(`## User story\n${story}`);

    const repeated = await testUserStoryAgainstPrompt(
      ORG_ID,
      primaryProblem.id,
      story,
      actor,
    );
    expect(repeated.workflow.prompt?.id).toBe(first.workflow.prompt?.id);
    expect(repeated.workflow.prompt?.revision).toBe(1);
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
    await requestImplementationApproval(ORG_ID, first.workflow.prompt!.id, actor);
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
