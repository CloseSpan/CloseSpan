import { beforeEach, describe, expect, it } from "vitest";
import { advanceLifecycle, approveAction, approveNotifications, getState, rejectAction, resetDemoState } from "./store";
import { ORG_ID } from "./seed";

const context = (key: string) => ({ actorId: "user_test", actorName: "Test User", idempotencyKey: key, traceId: `trace_${key}` });

describe("feedback-to-resolution workflow", () => {
  beforeEach(() => { process.env.PERSISTENCE_MODE = "memory"; resetDemoState(); });

  it("requires approval before creating the simulated work item", async () => {
    expect((await getState(ORG_ID)).workItem).toBeUndefined();
    const approved = await approveAction(ORG_ID, context("approve_001"));
    expect(approved.approval.status).toBe("Approved");
    expect(approved.workItem).toMatchObject({ id: "GH-1842", simulated: true });
    expect(approved.problemStage).toBe("Approved");
  });

  it("replays the same idempotent action but rejects a new approval", async () => {
    const first = await approveAction(ORG_ID, context("approve_001"));
    expect(await approveAction(ORG_ID, context("approve_001"))).toBe(first);
    await expect(approveAction(ORG_ID, context("approve_002"))).rejects.toThrow("no longer pending");
  });

  it("supports rejection as an audited terminal approval decision", async () => {
    const rejected = await rejectAction(ORG_ID, context("reject_001"));
    expect(rejected.approval.status).toBe("Rejected");
    expect(rejected.audit[0]?.action).toContain("Rejected");
    expect(rejected.workItem).toBeUndefined();
  });

  it("drafts after agent merge and approves only after verification", async () => {
    await approveAction(ORG_ID, context("approve_001"));
    await advanceLifecycle(ORG_ID, context("advance_001"));
    await advanceLifecycle(ORG_ID, context("advance_002"));
    await advanceLifecycle(ORG_ID, context("advance_003"));
    expect((await getState(ORG_ID)).problemStage).toBe("Release Ready");
    expect((await getState(ORG_ID)).notifications).toBe("Drafted");
    await expect(approveNotifications(ORG_ID, context("notify_early")))
      .rejects.toThrow("requires a verified resolution");
    await advanceLifecycle(ORG_ID, context("advance_004"));
    expect((await getState(ORG_ID)).problemStage).toBe("Released");
    await advanceLifecycle(ORG_ID, context("advance_005"));
    expect((await getState(ORG_ID)).problemStage).toBe("Verified");
    expect((await getState(ORG_ID)).notifications).toBe("Drafted");
    expect((await approveNotifications(ORG_ID, context("notify_001"))).notifications).toBe("Approved");
  });

  it("isolates state between organizations", async () => {
    await approveAction(ORG_ID, context("approve_001"));
    expect((await getState("org_other")).approval.status).toBe("Pending");
  });
});
