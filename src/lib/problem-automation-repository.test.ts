import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approveMemoryAction, resetMemoryState } from "./memory-store";
import {
  assessAutomatedStage,
  runProblemAutomationTick,
  type StageEvidence,
} from "./problem-automation-repository";
import { getMemoryProblemStages } from "./problem-automation-memory";
import { ORG_ID, primaryProblem } from "./seed";

const noEvidence: StageEvidence = {
  hasFeedback: false,
  hasInvestigation: false,
  hasPendingApproval: false,
  hasApprovedApproval: false,
  hasApprovedWork: false,
  hasReleaseRecord: false,
  hasPassingReleaseVerification: false,
  followUpComplete: false,
};

describe("problem stage automation", () => {
  beforeEach(() => {
    resetMemoryState();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T06:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("requires a human decision only in the approval queue", () => {
    expect(
      assessAutomatedStage("Needs review", {
        ...noEvidence,
        hasInvestigation: true,
        hasPendingApproval: true,
      }),
    ).toMatchObject({ nextStage: null, reason: "Waiting for the user decision." });
    expect(
      assessAutomatedStage("Needs review", {
        ...noEvidence,
        hasApprovedApproval: true,
      }).nextStage,
    ).toBe("Approved");
    expect(
      assessAutomatedStage("Approved", {
        ...noEvidence,
        hasApprovedApproval: true,
      }).nextStage,
    ).toBe("Planned");
  });

  it("does not fabricate release or verification progress", () => {
    expect(assessAutomatedStage("In progress", noEvidence).nextStage).toBeNull();
    expect(assessAutomatedStage("Released", noEvidence).nextStage).toBeNull();
    expect(
      assessAutomatedStage("Released", {
        ...noEvidence,
        hasPassingReleaseVerification: true,
      }).nextStage,
    ).toBe("Verified");
  });

  it("moves only one eligible ticket by one stage per tick", async () => {
    const first = await runProblemAutomationTick(ORG_ID);
    expect(first).toMatchObject({
      moved: true,
      problemId: "prob_filters",
      fromStage: "Detected",
      toStage: "Needs review",
    });
    expect(getMemoryProblemStages(ORG_ID).get(primaryProblem.id)).toBe(
      "Needs review",
    );

    expect(await runProblemAutomationTick(ORG_ID)).toMatchObject({
      moved: false,
      reason:
        "Another ticket moved recently; the coordinator is preserving one-at-a-time order.",
    });
    vi.advanceTimersByTime(30_000);
    const second = await runProblemAutomationTick(ORG_ID);
    expect(second).toMatchObject({
      moved: false,
      reason: "No ticket currently has enough evidence for its next stage.",
    });
    expect((await runProblemAutomationTick(ORG_ID)).moved).toBe(false);
  });

  it("resumes automatic progression after the user approves", async () => {
    await runProblemAutomationTick(ORG_ID);
    approveMemoryAction(ORG_ID, {
      actorId: "admin",
      actorName: "Admin",
      idempotencyKey: "approve_automation_test",
      traceId: "approve-automation-test",
    });

    vi.advanceTimersByTime(30_000);
    expect(await runProblemAutomationTick(ORG_ID)).toMatchObject({
      problemId: primaryProblem.id,
      fromStage: "Approved",
      toStage: "Planned",
    });
    vi.advanceTimersByTime(30_000);
    expect(await runProblemAutomationTick(ORG_ID)).toMatchObject({
      problemId: primaryProblem.id,
      fromStage: "Planned",
      toStage: "In progress",
    });
  });

  it("installs a durable workspace transition lease", async () => {
    const migration = await readFile(
      path.join(
        process.cwd(),
        "db/migrations/023_workflow_automation.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS workflow_automation_leases",
    );
    expect(migration).toContain(
      "org_id text PRIMARY KEY REFERENCES organizations(id)",
    );
  });
});
import { readFile } from "node:fs/promises";
import path from "node:path";
