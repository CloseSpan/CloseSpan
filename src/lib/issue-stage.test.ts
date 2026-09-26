import { describe, expect, it } from "vitest";
import { getIssueStage } from "./issue-stage";
import { problemActiveWorkStatuses } from "./problem-active-work";

describe("issue list stages", () => {
  it.each([
    ["Detected", "Reported"], ["Needs review", "Reported"],
    ["Approved", "Approved"], ["Planned", "Planned"],
    ["In progress", "In progress"], ["Release Ready", "Release review"],
    ["Released", "Release recorded"], ["Verified", "Verification recorded"],
    ["Closed", "Closed"], ["", "Status unavailable"],
  ])("describes %s without inventing verification", (stage, label) => {
    expect(getIssueStage({ stage }).label).toBe(label);
  });

  it.each(problemActiveWorkStatuses)("shows recorded active work for %s", (status) => {
    const stage = getIssueStage({ stage: "Detected", activeWork: { problemId: "issue-1", status, startedAt: "2026-09-12T12:00:00Z" } });
    expect(stage.group).not.toBe("Open");
    expect(stage.label).not.toMatch(/ready|validated|passed|successful/i);
  });

  it("does not reopen a closed issue from leftover work", () => {
    expect(getIssueStage({ stage: "Closed", activeWork: { problemId: "issue-1", status: "Working", startedAt: "2026-09-12T12:00:00Z" } }).label).toBe("Closed");
  });
  it("reserves human review labels for a current inbox decision", () => {
    expect(getIssueStage({ stage: "Needs review" }).label).toBe("Reported");
    expect(getIssueStage({ stage: "Needs review", reviewState: "needed" }).label).toBe("Needs your review");
    expect(getIssueStage({ stage: "Needs review", reviewState: "attention" }).label).toBe("Needs attention");
  });
});
