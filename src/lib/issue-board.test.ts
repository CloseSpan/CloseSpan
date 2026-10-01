import { describe, expect, it } from "vitest";
import { ISSUE_BOARD_GROUPS, issueBoardGroup } from "./issue-board";
import { problemActiveWorkStatuses } from "./problem-active-work";

describe("customer-success board groups", () => {
  it("exposes only four columns", () => {
    expect(ISSUE_BOARD_GROUPS).toEqual(["Open", "In progress", "Needs your review", "Closed"]);
  });
  it.each(["Detected", "Needs review", "Approved", "Planned"])("keeps %s open without inventing pending decisions", (stage) => {
    expect(issueBoardGroup({ stage })).toBe("Open");
  });
  it.each(["In progress", "Release Ready", "Released", "Verified"])("keeps %s in the workflow without claiming closure", (stage) => {
    expect(issueBoardGroup({ stage })).toBe("In progress");
  });
  it.each(problemActiveWorkStatuses)("uses actual %s activity regardless of intake stage", (status) => {
    expect(issueBoardGroup({ stage: "Detected", activeWork: { status } })).toBe("In progress");
  });
  it.each(["needed", "attention"] as const)("prioritizes a current %s decision over active work", (reviewState) => {
    expect(issueBoardGroup({ stage: "In progress", activeWork: { status: "CI" }, reviewState })).toBe("Needs your review");
  });
  it("does not reopen a closed issue based on leftover reviews or work", () => {
    expect(issueBoardGroup({ stage: "Closed", activeWork: { status: "Verifying" }, reviewState: "needed" })).toBe("Closed");
  });
});
