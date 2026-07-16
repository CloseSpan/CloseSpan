import { beforeEach, describe, expect, it } from "vitest";
import { advanceLifecycle, approveAction, approveNotifications, getState, rejectAction, resetDemoState } from "./store";
import { ORG_ID } from "./seed";

const context = (key: string) => ({ actorId: "user_test", actorName: "Test User", idempotencyKey: key, traceId: `trace_${key}` });

describe("feedback-to-resolution workflow", () => {
  beforeEach(resetDemoState);

  it("requires approval before creating the simulated work item", () => {
    expect(getState(ORG_ID).workItem).toBeUndefined();
    const approved = approveAction(ORG_ID, context("approve_001"));
    expect(approved.approval.status).toBe("Approved");
    expect(approved.workItem).toMatchObject({ id: "GH-1842", simulated: true });
    expect(approved.problemStage).toBe("Approved");
  });

  it("replays the same idempotent action but rejects a new approval", () => {
    const first = approveAction(ORG_ID, context("approve_001"));
    expect(approveAction(ORG_ID, context("approve_001"))).toBe(first);
    expect(() => approveAction(ORG_ID, context("approve_002"))).toThrow("no longer pending");
  });

  it("supports rejection as an audited terminal approval decision", () => {
    const rejected = rejectAction(ORG_ID, context("reject_001"));
    expect(rejected.approval.status).toBe("Rejected");
    expect(rejected.audit[0]?.action).toContain("Rejected");
    expect(rejected.workItem).toBeUndefined();
  });

  it("drafts and approves follow-up only after verification", () => {
    approveAction(ORG_ID, context("approve_001"));
    advanceLifecycle(ORG_ID, context("advance_001"));
    advanceLifecycle(ORG_ID, context("advance_002"));
    advanceLifecycle(ORG_ID, context("advance_003"));
    expect(getState(ORG_ID).notifications).toBe("Not drafted");
    advanceLifecycle(ORG_ID, context("advance_004"));
    expect(getState(ORG_ID).problemStage).toBe("Verified");
    expect(getState(ORG_ID).notifications).toBe("Drafted");
    expect(approveNotifications(ORG_ID, context("notify_001")).notifications).toBe("Approved");
  });

  it("isolates state between organizations", () => {
    approveAction(ORG_ID, context("approve_001"));
    expect(getState("org_other").approval.status).toBe("Pending");
  });
});
