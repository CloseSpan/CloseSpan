import { describe, expect, it } from "vitest";
import { detectRunFindings } from "./agent-run-findings";
import type { AgentRunSummaryView } from "./engineering-workflow-repository";

function run(overrides: Partial<AgentRunSummaryView> = {}): AgentRunSummaryView {
  return { id: "r1", approvalId: null, problemId: "p1", problemTitle: "Export", status: "Failed", repository: "org/repo", branchName: "fix", pullRequestUrl: null,
    queuedAt: "2026-10-01T10:00:00.000Z", completedAt: "2026-10-01T10:01:00.000Z", independentVerificationStatus: null,
    finalExecutionStatus: null, failureCode: "execution_timeout", ...overrides };
}
describe("run findings", () => {
  it("groups repeated failures without mixing repositories or source issues", () => {
    const findings = detectRunFindings([run(), run({ id: "r2" }), run({ id: "r3", repository: "org/other" }), run({ id: "r4", problemId: "p2" })]);
    expect(findings).toHaveLength(3);
    expect(findings[0].runIds).toEqual(["r1", "r2"]);
    expect(findings[0].title).toBe("Execution timed out");
  });
  it("never exposes raw messages, logs, or credentials in findings", () => {
    expect(JSON.stringify(detectRunFindings([run({ failureMessage: "api_key=secret-token person@example.com" })]))).not.toMatch(/secret-token|person@example/);
  });
  it("does not flag queued, cancelled, or clean runs just for their age", () => {
    expect(detectRunFindings([run({ status: "Queued" }), run({ status: "Cancelled" }), run({ status: "Draft PR opened" })])).toEqual([]);
  });
  it("detects failed tests and verification even when the run claims success", () => {
    expect(detectRunFindings([run({ status: "Draft PR opened", failedTestCount: 2, independentVerificationStatus: "failed" })]).map((f) => f.kind).sort()).toEqual(["tests", "verification"]);
  });
  it("supersedes a finding only after a later clean verified run for the same issue and repository", () => {
    const success = run({ id: "r2", status: "Draft PR opened", queuedAt: "2026-10-02T10:00:00.000Z", completedAt: "2026-10-02T10:01:00.000Z", independentVerificationStatus: "passed" });
    expect(detectRunFindings([run(), success])[0].resolved).toBe(true);
    expect(detectRunFindings([run(), { ...success, repository: "other" }])[0].resolved).toBe(false);
    expect(detectRunFindings([run(), { ...success, independentVerificationStatus: null }])[0].resolved).toBe(false);
  });
  it("does not equate verified implementation with recovered final execution", () => {
    const first = run({ status: "Draft PR opened", finalExecutionStatus: "Failed" });
    const later = run({ id: "r2", status: "Draft PR opened", queuedAt: "2026-10-02T10:00:00.000Z", completedAt: "2026-10-02T10:01:00.000Z", independentVerificationStatus: "passed" });
    expect(detectRunFindings([first, later])[0].resolved).toBe(false);
    expect(detectRunFindings([first, { ...later, finalExecutionStatus: "Succeeded" }])[0].resolved).toBe(true);
  });
  it("keeps unknown failure codes separate and fingerprint stable across retries", () => {
    const first = detectRunFindings([run({ failureCode: "unexpected_a" })])[0];
    expect(detectRunFindings([run({ id: "new", failureCode: "unexpected_a" })])[0].id).toBe(first.id);
    expect(detectRunFindings([run({ failureCode: "unexpected_a" }), run({ id: "r2", failureCode: "unexpected_b" })])).toHaveLength(2);
  });
});
